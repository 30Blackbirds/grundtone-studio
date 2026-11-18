import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// AUTH_MODE=oidc through the SAME entry points the org routes call
// (org-membership.ts, org-lookup.ts), against a REAL Postgres: proves the
// dispatch reaches Studio's own tables, never the auth service, and that each
// refusal arrives as the HTTP status the routes promise. What the store decides
// is measured in local-orgs.pg.test.ts.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

const sent: Array<{ to: string; subject: string; text: string }> = []
vi.mock('./email', () => ({
  email: { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) },
}))
vi.mock('./email-templates', async (orig) => ({
  ...(await orig<typeof import('./email-templates')>()),
  localeFromEvent: () => 'en',
}))

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let ops: typeof import('./org-membership')
let lookup: typeof import('./org-lookup')

const userIds: string[] = []
const orgIds: string[] = []

const ev = (u: { id: string; email: string } | null): H3Event =>
  ({
    context: u ? { auth: { sub: u.id, tenant: null, email: u.email } } : {},
  }) as unknown as H3Event

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  return p.then(
    () => 'ok' as const,
    (e: { statusCode?: number }) => e.statusCode ?? 500,
  )
}

describe.skipIf(!DATABASE_URL)('oidc-mode org operations (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    ops = await import('./org-membership')
    lookup = await import('./org-lookup')
  })

  beforeEach(() => {
    sent.length = 0
    vi.stubEnv('AUTH_MODE', 'oidc')
    vi.stubEnv('AUTHORIZER', 'local')
    vi.stubEnv('OIDC_ISSUER', 'https://idp.example.com')
    vi.stubEnv('OIDC_CLIENT_ID', 'studio')
    vi.stubEnv('NUXT_PUBLIC_APP_URL', 'https://studio.example.com')
    vi.stubEnv('ORG_CREATION', 'users')
    // If anything reached for the auth service it would find none.
    vi.stubEnv('AUTH_ISSUER', '')
    vi.stubEnv('AUTH_INTERNAL_URL', '')
    vi.stubEnv('ORG_WRITE_SERVICE_SECRET', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  afterAll(async () => {
    if (!db) return
    if (orgIds.length) {
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, orgIds))
      await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, orgIds))
      await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds))
    }
    if (userIds.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, userIds))
    await db.$client.end()
  })

  async function user(over: Partial<typeof schema.appUser.$inferInsert> = {}) {
    const id = randomUUID()
    const email = `u-${id.slice(0, 8)}@example.com`
    userIds.push(id)
    await db.insert(schema.appUser).values({ id, email, emailVerified: true, ...over })
    return { id, email }
  }
  async function newOrg(owner: { id: string; email: string }) {
    const deps = await ops.membershipDeps(ev(owner))
    const o = (await ops.createOrganization(deps, ev(owner), owner.id, {
      name: 'Acme',
      slug: `acme-${randomUUID().slice(0, 8)}`,
    })) as { id: string; slug: string }
    orgIds.push(o.id)
    return o
  }
  const deps = (u: { id: string; email: string }) => ops.membershipDeps(ev(u))

  it('does not need, and never calls, the auth service', async () => {
    const d = await deps(await user())
    await expect(d.auth('create', {})).rejects.toThrow(/no auth service/)
    // No ORG_WRITE_SERVICE_SECRET and no AUTH_INTERNAL_URL: better-auth mode would 503 here.
    expect(d.db).toBeDefined()
  })

  describe('creation policy', () => {
    it('defaults to operator-only: nobody creates through the API', async () => {
      vi.stubEnv('ORG_CREATION', '')
      const u = await user()
      expect(
        await status(
          ops.createOrganization(await deps(u), ev(u), u.id, { name: 'X', slug: 'x-1' }),
        ),
      ).toBe(403)
      expect(
        await db.select().from(schema.organization).where(eq(schema.organization.slug, 'x-1')),
      ).toEqual([])
    })

    it('an unknown value refuses rather than guessing', async () => {
      vi.stubEnv('ORG_CREATION', 'everyone')
      const u = await user()
      expect(
        await status(
          ops.createOrganization(await deps(u), ev(u), u.id, { name: 'X', slug: 'x-2' }),
        ),
      ).toBe(500)
    })

    it('users: creates, makes the caller owner, and a taken slug is 409', async () => {
      const u = await user()
      const o = await newOrg(u)
      expect((await lookup.lookupOrgById(ev(u), o.id))!.members).toEqual([
        { id: u.id, userId: u.id, role: 'owner' },
      ])
      expect(
        await status(
          ops.createOrganization(await deps(u), ev(u), u.id, { name: 'Y', slug: o.slug }),
        ),
      ).toBe(409)
    })

    it('an unauthenticated caller is 401', async () => {
      expect(
        await status(
          ops.createOrganization(await deps(await user()), ev(null), 'x', {
            name: 'Y',
            slug: 'y-1',
          }),
        ),
      ).toBe(401)
    })
  })

  describe('lookups are scoped to the caller', () => {
    it('a member sees the org with its members; an outsider, a machine key and a malformed id see null', async () => {
      const owner = await user()
      const outsider = await user()
      const o = await newOrg(owner)
      expect((await lookup.lookupOrgBySlug(ev(owner), o.slug))!.id).toBe(o.id)
      expect(await lookup.lookupOrgBySlug(ev(outsider), o.slug)).toBeNull()
      expect(await lookup.lookupOrgById(ev(outsider), o.id)).toBeNull()
      expect(await lookup.lookupOrgById(ev(owner), "x' or '1'='1")).toBeNull()
      const machine = { id: 'machine:abc', email: '' }
      expect(await lookup.lookupOrgById(ev(machine), o.id)).toBeNull()
      expect(await lookup.lookupOrgById(ev(null), o.id)).toBeNull()
    })

    it("lists only the caller's organisations", async () => {
      const a = await user()
      const b = await user()
      const oa = await newOrg(a)
      await newOrg(b)
      expect((await lookup.listCallerOrgs(ev(a))).map((o) => o.id)).toEqual([oa.id])
      expect(await lookup.listCallerOrgs(ev(null))).toEqual([])
    })
  })

  describe('refusals arrive as the promised status', () => {
    it('outsider 404, member 403, last owner 409, unknown target 404', async () => {
      const owner = await user()
      const member = await user()
      const outsider = await user()
      const o = await newOrg(owner)
      await db
        .insert(schema.orgMember)
        .values({ organizationId: o.id, userId: member.id, role: 'member' })

      const call = (
        u: { id: string; email: string },
        fn: 'role' | 'remove' | 'leave' | 'delete',
        target = owner.id,
      ) =>
        deps(u).then((d) =>
          fn === 'role'
            ? ops.changeMemberRole(d, ev(u), 'admin', o.id, target, 'member')
            : fn === 'remove'
              ? ops.removeMember(d, ev(u), 'admin', o.id, target)
              : fn === 'leave'
                ? ops.leaveOrganization(d, ev(u), u.id, o.id)
                : ops.deleteOrganization(d, ev(u), o.id),
        )

      for (const fn of ['role', 'remove', 'leave', 'delete'] as const) {
        expect(await status(call(outsider, fn))).toBe(404)
      }
      expect(await status(call(member, 'role'))).toBe(403)
      expect(await status(call(member, 'remove'))).toBe(403)
      expect(await status(call(member, 'delete'))).toBe(403)
      expect(await status(call(owner, 'leave'))).toBe(409)
      expect(await status(call(owner, 'role'))).toBe(409)
      expect(await status(call(owner, 'remove', randomUUID()))).toBe(404)
      expect(await status(call(member, 'leave'))).toBe('ok')
    })

    it('an owner may promote another owner through the route entry point', async () => {
      const owner = await user()
      const member = await user()
      const o = await newOrg(owner)
      await db
        .insert(schema.orgMember)
        .values({ organizationId: o.id, userId: member.id, role: 'member' })
      await ops.changeMemberRole(await deps(owner), ev(owner), 'owner', o.id, member.id, 'owner')
      expect(
        (await lookup.lookupOrgById(ev(owner), o.id))!.members!.map((m) => m.role).sort(),
      ).toEqual(['owner', 'owner'])
    })
  })

  describe('invitations', () => {
    const accept = async (u: { id: string; email: string }, token: string) =>
      ops.acceptInvitation(await deps(u), ev(u), u.id, token)

    it('mails a link that works once for the invited address; the response never carries the token', async () => {
      const owner = await user()
      const invitee = await user()
      const o = await newOrg(owner)
      const res = await ops.inviteMember(await deps(owner), ev(owner), 'owner', o.id, {
        email: invitee.email.toUpperCase(),
        role: 'admin',
      })
      expect(JSON.stringify(res)).not.toMatch(/token/i)
      expect(sent).toHaveLength(1)
      expect(sent[0]!.to).toBe(invitee.email.toUpperCase())
      const token = sent[0]!.text.match(
        /https:\/\/studio\.example\.com\/invitations\/([\w-]+)/,
      )![1]!
      expect(await accept(invitee, token)).toEqual({ organizationId: o.id, role: 'admin' })
      expect(await status(accept(invitee, token))).toBe(404)
    })

    it('another person, an unverified e-mail and a bogus token are refused with the promised statuses', async () => {
      const owner = await user()
      const thief = await user()
      const unverified = await user({ emailVerified: false })
      const o = await newOrg(owner)
      await ops.inviteMember(await deps(owner), ev(owner), 'owner', o.id, {
        email: unverified.email,
        role: 'member',
      })
      const token = sent[0]!.text.match(/invitations\/([\w-]+)/)![1]!
      expect(await status(accept(thief, token))).toBe(404)
      expect(await status(accept(unverified, token))).toBe(403)
      expect(await status(accept(unverified, 'nope'))).toBe(404)
      vi.stubEnv('OIDC_REQUIRE_EMAIL_VERIFIED', 'false')
      expect(await status(accept(unverified, token))).toBe('ok')
    })

    it('a member may not invite (403), an outsider gets 404, and nothing is mailed', async () => {
      const owner = await user()
      const member = await user()
      const outsider = await user()
      const o = await newOrg(owner)
      await db
        .insert(schema.orgMember)
        .values({ organizationId: o.id, userId: member.id, role: 'member' })
      const invite = (u: { id: string; email: string }) =>
        deps(u).then((d) =>
          ops.inviteMember(d, ev(u), 'admin', o.id, { email: 'x@example.com', role: 'member' }),
        )
      expect(await status(invite(member))).toBe(403)
      expect(await status(invite(outsider))).toBe(404)
      expect(sent).toEqual([])
    })
  })

  it('assignableRoles adds owner in oidc mode only', async () => {
    const { assignableRoles } = await import('./org-membership-input')
    expect(assignableRoles()).toContain('owner')
    vi.stubEnv('AUTH_MODE', '')
    expect(assignableRoles()).not.toContain('owner')
  })
})
