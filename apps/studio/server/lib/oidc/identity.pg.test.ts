import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readOidcConfig, type OidcConfig } from './config'
import { OidcLoginError, type VerifiedClaims } from './flow'
import { resolveUser } from './identity'

// JIT user creation and identity mapping against a REAL Postgres: the unique
// index on (issuer, subject) is what makes the race safe.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')

const issuer = `https://idp-${randomUUID()}.example.com`
const baseEnv = {
  AUTHORIZER: 'local',
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: 'studio',
  OIDC_REDIRECT_URI: 'https://studio.example.com/api/oidc/callback',
}
const config = (extra: Record<string, string> = {}): OidcConfig =>
  readOidcConfig({ ...baseEnv, ...extra })

const claims = (over: Partial<VerifiedClaims> = {}): VerifiedClaims => ({
  issuer,
  subject: `sub-${randomUUID()}`,
  email: 'a@example.com',
  emailVerified: true,
  name: 'Ada',
  ...over,
})

async function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: unknown) => (e instanceof OidcLoginError ? e.code : `other:${String(e)}`),
  )
}

describe.skipIf(!DATABASE_URL)('OIDC identity mapping (real Postgres)', () => {
  const created: string[] = []

  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
  })

  afterAll(async () => {
    if (!db) return
    if (created.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, created))
    await db.$client.end()
  })

  const track = async (c: VerifiedClaims, cfg = config()) => {
    const r = await resolveUser(db, cfg, c)
    created.push(r.id)
    return r
  }

  it('creates a user at first login and returns the same user at the next', async () => {
    const c = claims()
    const first = await track(c)
    expect(first.created).toBe(true)
    const again = await resolveUser(db, config(), c)
    expect(again).toEqual({ id: first.id, created: false })
  })

  it('gives a new user no access: no membership row exists', async () => {
    const { id } = await track(claims())
    expect(await db.select().from(schema.orgMember).where(eq(schema.orgMember.userId, id))).toEqual(
      [],
    )
    expect(
      await db.select().from(schema.projectMember).where(eq(schema.projectMember.userId, id)),
    ).toEqual([])
  })

  it('does not merge two identities that share an e-mail address', async () => {
    const a = await track(claims({ subject: 'one', email: 'same@example.com' }))
    const b = await track(claims({ subject: 'two', email: 'same@example.com' }))
    expect(a.id).not.toBe(b.id)
  })

  it('does not merge the same subject from two issuers', async () => {
    const subject = `shared-${randomUUID()}`
    const a = await track(claims({ subject }))
    const b = await track(claims({ subject, issuer: `${issuer}/other` }))
    expect(a.id).not.toBe(b.id)
  })

  it('refreshes display fields but never changes who the user is', async () => {
    const c = claims()
    const { id } = await track(c)
    await resolveUser(db, config(), {
      ...c,
      email: 'new@example.com',
      emailVerified: false,
      name: 'New',
    })
    const [row] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, id))
    expect(row).toMatchObject({ email: 'new@example.com', emailVerified: false, name: 'New' })
    expect(row!.lastLoginAt).toBeInstanceOf(Date)
  })

  it('refuses a disabled user, and creates nothing for them', async () => {
    const c = claims()
    const { id } = await track(c)
    await db.update(schema.appUser).set({ disabledAt: new Date() }).where(eq(schema.appUser.id, id))
    expect(await code(resolveUser(db, config(), c))).toBe('disabled')
    const [row] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, id))
    expect(row!.name).toBe('Ada')
  })

  it('refuses an unknown user when JIT is off, and keeps known ones', async () => {
    const off = config({ OIDC_JIT: 'off' })
    const known = claims()
    await track(known)
    expect(await code(resolveUser(db, off, claims()))).toBe('jit_off')
    expect((await resolveUser(db, off, known)).created).toBe(false)
  })

  describe('e-mail domain allowlist', () => {
    const cfg = () => config({ OIDC_ALLOWED_EMAIL_DOMAINS: 'example.com' })
    it('lets a verified address in an allowed domain in', async () => {
      await track(claims({ email: 'x@Example.com' }), cfg())
    })
    it.each([
      ['another domain', { email: 'x@evil.example' }],
      ['an unverified address in an allowed domain', { emailVerified: false }],
      ['no e-mail at all', { email: null }],
      ['a lookalike suffix', { email: 'x@notexample.com' }],
      ['a subdomain', { email: 'x@sub.example.com' }],
    ])('refuses %s', async (_n, over) => {
      expect(await code(resolveUser(db, cfg(), claims(over)))).toBe('domain_not_allowed')
    })
  })

  it('creates exactly one user when the same new subject logs in twice at once', async () => {
    const c = claims()
    const results = await Promise.all([
      resolveUser(db, config(), c),
      resolveUser(db, config(), c),
      resolveUser(db, config(), c),
    ])
    created.push(...results.map((r) => r.id))
    expect(new Set(results.map((r) => r.id)).size).toBe(1)
    const rows = await db
      .select()
      .from(schema.userIdentity)
      .where(eq(schema.userIdentity.subject, c.subject))
    expect(rows).toHaveLength(1)
    // No orphaned user rows from the loser(s).
    const users = await db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.id, rows[0]!.userId))
    expect(users).toHaveLength(1)
  })
})
