import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The /api/auth/** answers the browser's session and organisation reads get in
// AUTH_MODE=oidc, against a REAL Postgres. Denials first: a caller sees only
// what their own membership allows, and nothing is ever proxied.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

interface Fake {
  path: string
  method: string
  query: Record<string, string>
  body: unknown
  headers: Record<string, string>
  cookies: Record<string, string>
  context: { auth?: { sub: string; tenant: null; email?: string } }
}
const cleared: string[] = []
vi.mock('h3', async (orig) => ({
  ...(await orig<typeof import('h3')>()),
  getQuery: (e: Fake) => e.query,
  readBody: async (e: Fake) => e.body,
  getCookie: (e: Fake, n: string) => e.cookies[n],
  deleteCookie: (_e: Fake, n: string) => void cleared.push(n),
  getRequestHeader: (e: Fake, n: string) => e.headers[n.toLowerCase()],
}))

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let compat: typeof import('./auth-compat')
let orgs: typeof import('../local-orgs')
let sessions: typeof import('./sessions')

const userIds: string[] = []
const orgIds: string[] = []

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  return p.then(
    () => 'ok' as const,
    (e: { statusCode?: number }) => e.statusCode ?? 500,
  )
}

describe.skipIf(!DATABASE_URL)('oidc-mode /api/auth answers (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    compat = await import('./auth-compat')
    orgs = await import('../local-orgs')
    sessions = await import('./sessions')
  })
  beforeEach(() => {
    cleared.length = 0
    vi.stubEnv('AUTH_MODE', 'oidc')
    vi.stubEnv('AUTHORIZER', 'local')
    vi.stubEnv('OIDC_ISSUER', 'https://idp.example.com')
    vi.stubEnv('OIDC_CLIENT_ID', 'studio')
    vi.stubEnv('NUXT_PUBLIC_APP_URL', 'https://studio.example.com')
  })
  afterEach(() => vi.unstubAllEnvs())
  afterAll(async () => {
    if (!db) return
    if (orgIds.length) {
      await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, orgIds))
      await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds))
    }
    if (userIds.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, userIds))
    await db.$client.end()
  })

  async function user() {
    const id = randomUUID()
    const email = `u-${id.slice(0, 8)}@example.com`
    userIds.push(id)
    await db.insert(schema.appUser).values({ id, email, emailVerified: true, name: 'Ada' })
    return { id, email }
  }
  const ev = (
    u: { id: string; email: string } | null,
    method: string,
    path: string,
    extra: Partial<Fake> = {},
  ): H3Event =>
    ({
      path: `/api/auth/${path}`,
      method,
      query: {},
      body: null,
      headers: { origin: 'https://studio.example.com', host: 'studio.example.com' },
      cookies: {},
      context: u ? { auth: { sub: u.id, tenant: null, email: u.email } } : {},
      ...extra,
    }) as unknown as H3Event
  async function newOrg(owner: { id: string; email: string }) {
    const o = await orgs.createOrganization(
      db,
      { id: owner.id, email: owner.email },
      {
        name: 'Acme',
        slug: `acme-${randomUUID().slice(0, 8)}`,
      },
    )
    orgIds.push(o.id)
    return o
  }

  it('refuses paths it does not answer, and never proxies', async () => {
    const u = await user()
    for (const p of ['sign-in/email', 'change-password', 'delete-user', 'organization/leave'])
      expect(await status(compat.answerOidcAuthPath(ev(u, 'POST', p)))).toBe(501)
    expect(await status(compat.answerOidcAuthPath(ev(u, 'POST', 'get-session')))).toBe(501)
  })

  it('anonymous callers get 401 on org reads and null for the session', async () => {
    for (const p of [
      'organization/list',
      'organization/list-members',
      'organization/get-full-organization',
    ])
      expect(await status(compat.answerOidcAuthPath(ev(null, 'GET', p)))).toBe(401)
    expect(await compat.answerOidcAuthPath(ev(null, 'GET', 'get-session'))).toBeNull()
  })

  it('a machine principal is not a browser user', async () => {
    const m = { id: 'machine:abc', email: '' }
    expect(await status(compat.answerOidcAuthPath(ev(m, 'GET', 'organization/list')))).toBe(401)
  })

  it('members read their org; an outsider gets 404 and an empty list', async () => {
    const owner = await user()
    const outsider = await user()
    const o = await newOrg(owner)
    const q = { organizationId: o.id }
    const list = (await compat.answerOidcAuthPath(
      ev(owner, 'GET', 'organization/list-members', { query: q }),
    )) as {
      members: Array<{ userId: string; role: string; user: { email: string } }>
      total: number
    }
    expect(list.total).toBe(1)
    expect(list.members[0]).toMatchObject({
      userId: owner.id,
      role: 'owner',
      user: { email: owner.email },
    })
    expect(
      await status(
        compat.answerOidcAuthPath(ev(outsider, 'GET', 'organization/list-members', { query: q })),
      ),
    ).toBe(404)
    expect(
      await status(
        compat.answerOidcAuthPath(
          ev(outsider, 'GET', 'organization/list-invitations', { query: q }),
        ),
      ),
    ).toBe(404)
    expect(await compat.answerOidcAuthPath(ev(outsider, 'GET', 'organization/list'))).toEqual([])
    expect(
      await compat.answerOidcAuthPath(
        ev(outsider, 'GET', 'organization/get-full-organization', { query: q }),
      ),
    ).toBeNull()
    expect(
      ((await compat.answerOidcAuthPath(ev(owner, 'GET', 'organization/list'))) as unknown[])
        .length,
    ).toBe(1)
  })

  it('a plain member may not list invitations; a missing org id is 400', async () => {
    const owner = await user()
    const member = await user()
    const o = await newOrg(owner)
    await db
      .insert(schema.orgMember)
      .values({ organizationId: o.id, userId: member.id, role: 'member' })
    expect(
      await status(
        compat.answerOidcAuthPath(
          ev(member, 'GET', 'organization/list-invitations', { query: { organizationId: o.id } }),
        ),
      ),
    ).toBe(403)
    expect(
      await status(compat.answerOidcAuthPath(ev(owner, 'GET', 'organization/list-members'))),
    ).toBe(400)
  })

  it('cancel-invitation: a member cannot, an outsider sees 404, the owner can; bad id is 404', async () => {
    const owner = await user()
    const member = await user()
    const outsider = await user()
    const o = await newOrg(owner)
    await db
      .insert(schema.orgMember)
      .values({ organizationId: o.id, userId: member.id, role: 'member' })
    const inv = await orgs.createInvitation(db, { id: owner.id, email: owner.email }, o.id, {
      email: 'x@example.com',
      role: 'member',
    })
    const cancel = (u: { id: string; email: string }, id: string) =>
      compat.answerOidcAuthPath(
        ev(u, 'POST', 'organization/cancel-invitation', { body: { invitationId: id } }),
      )
    expect(await status(cancel(member, inv.id))).toBe(403)
    expect(await status(cancel(outsider, inv.id))).toBe(404)
    expect(await status(cancel(owner, 'not-a-uuid'))).toBe(400)
    expect(await status(cancel(owner, randomUUID()))).toBe(404)
    expect(await status(cancel(owner, inv.id))).toBe('ok')
    expect(
      await compat.answerOidcAuthPath(
        ev(owner, 'GET', 'organization/list-invitations', { query: { organizationId: o.id } }),
      ),
    ).toEqual([])
  })

  it('cancel-invitation refuses a cross-origin post', async () => {
    const owner = await user()
    const e = ev(owner, 'POST', 'organization/cancel-invitation', {
      body: { invitationId: randomUUID() },
      headers: { origin: 'https://evil.example', host: 'studio.example.com' },
    })
    expect(await status(compat.answerOidcAuthPath(e))).toBe(403)
  })

  it('get-session reflects the cookie; sign-out ends the session', async () => {
    const u = await user()
    const { readOidcConfig, oidcSessionCookie } = await import('./config')
    const cfg = readOidcConfig()
    const name = oidcSessionCookie(cfg).name
    const { token } = await sessions.createSession(db, cfg, { userId: u.id, idToken: null })
    const withCookie = (m: string, p: string) => ev(u, m, p, { cookies: { [name]: token } })
    const s = (await compat.answerOidcAuthPath(withCookie('GET', 'get-session'))) as {
      user: { id: string; email: string; emailVerified: boolean; name: string }
    }
    expect(s.user).toMatchObject({ id: u.id, email: u.email, emailVerified: true, name: 'Ada' })
    expect(
      await compat.answerOidcAuthPath(
        ev(u, 'GET', 'get-session', { cookies: { [name]: 'bogus' } }),
      ),
    ).toBeNull()
    await compat.answerOidcAuthPath(withCookie('POST', 'sign-out'))
    expect(cleared).toContain(name)
    expect(await compat.answerOidcAuthPath(withCookie('GET', 'get-session'))).toBeNull()
  })
})
