import { randomUUID } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { eq, inArray } from 'drizzle-orm'
import { createError, createEvent, type H3Event } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Organisation isolation in AUTH_MODE=oidc along the whole request chain, against
// a REAL Postgres: a real session cookie, the real auth middleware, then the
// same guards the routes call (requireProjectAccess, requireOrgRole, the org
// lookups). Each piece is tested on its own elsewhere (sessions, local-orgs,
// local-authorizer, auth-compat); this file is what proves the pieces still
// meet: nothing the session carries, and nothing a person holds in one
// organisation, opens another.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let middleware: (event: H3Event) => Promise<void>
let access: typeof import('../project-access')
let lookup: typeof import('../org-lookup')
let orgs: typeof import('../local-orgs')
let sessions: typeof import('./sessions')

const SESSION_COOKIE = '__Host-studio_session'
const userIds: string[] = []
const orgIds: string[] = []

interface Person {
  id: string
  email: string
  cookie: string
}

/** A request as the browser sends it, run through the real auth middleware. */
async function request(cookie: string | null): Promise<H3Event> {
  const req = new IncomingMessage(new Socket())
  req.headers = cookie ? { cookie } : {}
  const event = createEvent(req, new ServerResponse(req))
  await middleware(event)
  return event
}

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  return p.then(
    () => 'ok' as const,
    (e: { statusCode?: number }) => e.statusCode ?? 500,
  )
}

describe.skipIf(!DATABASE_URL)('organisation isolation in oidc mode (real Postgres)', () => {
  let a: Person // owner of A
  let b: Person // owner of B
  let m: Person // member of A
  let orgA: { id: string; slug: string }
  let orgB: { id: string; slug: string }
  let projA: string
  let projB: string

  async function person(): Promise<Person> {
    const id = randomUUID()
    const email = `iso-${id.slice(0, 8)}@example.com`
    userIds.push(id)
    await db.insert(schema.appUser).values({ id, email, emailVerified: true })
    const { token } = await sessions.createSession(
      db,
      { sessionMaxMs: 60 * 60 * 1000 },
      { userId: id, idToken: null },
    )
    return { id, email, cookie: `${SESSION_COOKIE}=${token}` }
  }

  async function newOrg(owner: Person): Promise<{ id: string; slug: string }> {
    const o = await orgs.createOrganization(
      db,
      { id: owner.id, email: owner.email },
      {
        name: 'Iso',
        slug: `iso-${randomUUID().slice(0, 8)}`,
      },
    )
    orgIds.push(o.id)
    return o
  }

  async function project(orgId: string): Promise<string> {
    const [row] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, slug: `p-${randomUUID().slice(0, 8)}`, name: 'iso' })
      .returning({ id: schema.project.id })
    return row!.id
  }

  beforeAll(async () => {
    vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
    vi.stubGlobal('createError', createError)
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    middleware = (await import('~~/server/middleware/auth')).default as unknown as typeof middleware
    access = await import('../project-access')
    lookup = await import('../org-lookup')
    orgs = await import('../local-orgs')
    sessions = await import('./sessions')
  })

  beforeEach(async () => {
    vi.stubEnv('AUTH_MODE', 'oidc')
    vi.stubEnv('AUTHORIZER', 'local')
    vi.stubEnv('OIDC_ISSUER', 'https://idp.example.com')
    vi.stubEnv('OIDC_CLIENT_ID', 'studio')
    vi.stubEnv('NUXT_PUBLIC_APP_URL', 'https://studio.example.com')
    // If anything reached for the auth service it would find none.
    vi.stubEnv('AUTH_ISSUER', '')
    vi.stubEnv('AUTH_INTERNAL_URL', '')

    a = await person()
    b = await person()
    m = await person()
    orgA = await newOrg(a)
    orgB = await newOrg(b)
    await db
      .insert(schema.orgMember)
      .values({ organizationId: orgA.id, userId: m.id, role: 'member' })
    projA = await project(orgA.id)
    projB = await project(orgB.id)
  })
  afterEach(() => vi.unstubAllEnvs())

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (!db) return
    if (orgIds.length) {
      await db.delete(schema.project).where(inArray(schema.project.organizationId, orgIds))
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, orgIds))
      await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, orgIds))
      await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds))
    }
    if (userIds.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, userIds))
    await db.$client.end()
  })

  it("an owner's session reaches their own organisation and nothing of another's", async () => {
    const ev = await request(a.cookie)
    expect(ev.context.auth?.sub).toBe(a.id)

    expect((await access.requireProjectAccess(ev, projA, 'admin')).role).toBe('admin')
    expect((await access.requireOrgRole(ev, orgA.id, 'owner')).role).toBe('owner')

    expect(await status(access.requireProjectAccess(ev, projB, 'viewer'))).toBe(403)
    expect(await status(access.requireOrgRole(ev, orgB.id, 'billing'))).toBe(403)
    expect(await lookup.lookupOrgById(ev, orgB.id)).toBeNull()
    expect(await lookup.lookupOrgBySlug(ev, orgB.slug)).toBeNull()
    expect((await lookup.listCallerOrgs(ev)).map((o) => o.id)).toEqual([orgA.id])
  })

  it('the active-organisation field on a session grants nothing', async () => {
    // A session pointed at B, by a bug or by a hand in the database, must not
    // turn into membership of B: the tenant is a preference, never a grant.
    await db
      .update(schema.appSession)
      .set({ activeOrganizationId: orgB.id })
      .where(eq(schema.appSession.userId, a.id))
    const ev = await request(a.cookie)
    expect(ev.context.auth?.tenant).toBe(orgB.id)

    expect(await status(access.requireProjectAccess(ev, projB, 'viewer'))).toBe(403)
    expect(await status(access.requireOrgRole(ev, orgB.id, 'billing'))).toBe(403)
    expect(await lookup.lookupOrgById(ev, orgB.id)).toBeNull()
    expect((await lookup.listCallerOrgs(ev)).map((o) => o.id)).toEqual([orgA.id])
  })

  it('a member views their organisation, does not edit, and sees no other', async () => {
    const ev = await request(m.cookie)
    expect((await access.requireProjectAccess(ev, projA, 'viewer')).role).toBe('viewer')
    expect(await status(access.requireProjectAccess(ev, projA, 'editor'))).toBe(403)
    expect(await status(access.requireOrgRole(ev, orgA.id, 'admin'))).toBe(403)
    expect(await status(access.requireProjectAccess(ev, projB, 'viewer'))).toBe(403)
  })

  it('removal takes effect on the next request of a session that is still open', async () => {
    expect(await status(access.requireProjectAccess(await request(m.cookie), projA))).toBe('ok')

    await orgs.removeMember(db, { id: a.id, email: a.email }, orgA.id, m.id)

    const ev = await request(m.cookie)
    // Still signed in: removal from an organisation is not a sign-out.
    expect(ev.context.auth?.sub).toBe(m.id)
    expect(await status(access.requireProjectAccess(ev, projA))).toBe(403)
    expect(await status(access.requireOrgRole(ev, orgA.id, 'billing'))).toBe(403)
    expect(await lookup.lookupOrgById(ev, orgA.id)).toBeNull()
    expect(await lookup.listCallerOrgs(ev)).toEqual([])
  })

  it('a pending invitation is not membership', async () => {
    const x = await person()
    await orgs.createInvitation(db, { id: a.id, email: a.email }, orgA.id, {
      email: x.email,
      role: 'manager',
    })
    const ev = await request(x.cookie)
    expect(ev.context.auth?.sub).toBe(x.id)
    expect(await status(access.requireProjectAccess(ev, projA))).toBe(403)
    expect(await status(access.requireOrgRole(ev, orgA.id, 'billing'))).toBe(403)
    expect(await lookup.lookupOrgById(ev, orgA.id)).toBeNull()
  })

  it('a disabled user has no actor, even with a session issued after the disable', async () => {
    await sessions.disableUser(db, m.id)
    // Disabling deletes the sessions; a login that raced it would leave a new
    // one, so the session check must refuse on its own.
    const { token } = await sessions.createSession(
      db,
      { sessionMaxMs: 60 * 60 * 1000 },
      { userId: m.id, idToken: null },
    )
    for (const cookie of [m.cookie, `${SESSION_COOKIE}=${token}`]) {
      const ev = await request(cookie)
      expect(ev.context.auth).toBeUndefined()
      expect(await status(access.requireProjectAccess(ev, projA))).toBe(401)
      expect(await lookup.listCallerOrgs(ev)).toEqual([])
    }
  })

  it('without a Studio session there is no actor, whatever other cookie is sent', async () => {
    for (const cookie of [
      null,
      `${SESSION_COOKIE}=not-a-token-we-issued`,
      // A Better Auth cookie means nothing in oidc mode.
      'better-auth.session_token=whatever; __Secure-better-auth.session_token=whatever',
      // The session token under a name Studio does not read on https.
      a.cookie.replace(SESSION_COOKIE, 'studio_session'),
    ]) {
      const ev = await request(cookie)
      expect(ev.context.auth, String(cookie)).toBeUndefined()
      expect(await status(access.requireProjectAccess(ev, projA)), String(cookie)).toBe(401)
    }
  })
})
