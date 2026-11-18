import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Owner transfer and the caller's own roles (AUTH_MODE=oidc), against a REAL
// Postgres. Denials first: only an owner transfers, never to an outsider, a
// disabled user or themself, and the organisation is never without an owner.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

vi.mock('./email', () => ({ email: { send: async () => {} } }))

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let local: typeof import('./org-membership-local')
let orgs: typeof import('./local-orgs')

const userIds: string[] = []
const orgIds: string[] = []
type U = { id: string; email: string }
const ev = (u: U | null): H3Event =>
  ({
    context: u ? { auth: { sub: u.id, tenant: null, email: u.email } } : {},
  }) as unknown as H3Event

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  return p.then(
    () => 'ok' as const,
    (e: { statusCode?: number }) => e.statusCode ?? 500,
  )
}

describe.skipIf(!DATABASE_URL)('ownership transfer (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    local = await import('./org-membership-local')
    orgs = await import('./local-orgs')
  })
  beforeEach(() => {
    vi.stubEnv('AUTH_MODE', 'oidc')
    vi.stubEnv('AUTHORIZER', 'local')
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

  async function user(over: Partial<typeof schema.appUser.$inferInsert> = {}): Promise<U> {
    const id = randomUUID()
    const email = `u-${id.slice(0, 8)}@example.com`
    userIds.push(id)
    await db.insert(schema.appUser).values({ id, email, emailVerified: true, ...over })
    return { id, email }
  }
  async function setup() {
    const owner = await user()
    const o = await orgs.createOrganization(db, owner, {
      name: 'Acme',
      slug: `acme-${randomUUID().slice(0, 8)}`,
    })
    orgIds.push(o.id)
    const add = async (role: string, over: Partial<typeof schema.appUser.$inferInsert> = {}) => {
      const u = await user(over)
      await db.insert(schema.orgMember).values({ organizationId: o.id, userId: u.id, role })
      return u
    }
    return { owner, orgId: o.id, add }
  }
  const roles = async (orgId: string) =>
    Object.fromEntries(
      (
        await db.select().from(schema.orgMember).where(eq(schema.orgMember.organizationId, orgId))
      ).map((m) => [m.userId, m.role]),
    )
  const transfer = (u: U | null, orgId: string, to: string, stepDownTo?: 'member' | 'manager') =>
    local.transferOwnershipLocal(db, ev(u), orgId, to, stepDownTo)

  describe('denials', () => {
    it('a manager, an admin and an outsider cannot transfer; nothing changes', async () => {
      const { owner, orgId, add } = await setup()
      const manager = await add('manager')
      const admin = await add('admin')
      const outsider = await user()
      const before = await roles(orgId)
      expect(await status(transfer(manager, orgId, admin.id))).toBe(403)
      expect(await status(transfer(admin, orgId, manager.id))).toBe(403)
      expect(await status(transfer(outsider, orgId, owner.id))).toBe(404)
      expect(await status(transfer(null, orgId, owner.id))).toBe(401)
      expect(await roles(orgId)).toEqual(before)
    })

    it('not to a non-member, a disabled member, or oneself', async () => {
      const { owner, orgId, add } = await setup()
      const stranger = await user()
      const disabled = await add('member', { disabledAt: new Date() })
      const before = await roles(orgId)
      expect(await status(transfer(owner, orgId, stranger.id))).toBe(404)
      expect(await status(transfer(owner, orgId, disabled.id))).toBe(400)
      expect(await status(transfer(owner, orgId, owner.id))).toBe(400)
      expect(await roles(orgId)).toEqual(before)
    })

    it('a member of ANOTHER organisation cannot be reached through this one', async () => {
      const a = await setup()
      const b = await setup()
      const bMember = await b.add('member')
      expect(await status(transfer(a.owner, a.orgId, bMember.id))).toBe(404)
      expect((await roles(b.orgId))[bMember.id]).toBe('member')
    })
  })

  it('hands ownership over in one step; the old owner steps down to manager by default', async () => {
    const { owner, orgId, add } = await setup()
    const m = await add('member')
    expect(await transfer(owner, orgId, m.id)).toEqual({ ok: true })
    expect(await roles(orgId)).toEqual({ [owner.id]: 'manager', [m.id]: 'owner' })
    const log = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, orgId),
          eq(schema.auditLog.action, 'member.role_changed'),
        ),
      )
    expect(log).toHaveLength(2)
    // The previous owner no longer can.
    expect(await status(transfer(owner, orgId, m.id))).toBe(403)
  })

  it('an existing co-owner keeps owner; the caller may step down to member', async () => {
    const { owner, orgId, add } = await setup()
    const co = await add('owner')
    await transfer(owner, orgId, co.id, 'member')
    expect(await roles(orgId)).toEqual({ [owner.id]: 'member', [co.id]: 'owner' })
  })

  it('two owners transferring to each other at once never leave the org without an owner', async () => {
    const { owner, orgId, add } = await setup()
    const co = await add('owner')
    await Promise.allSettled([transfer(owner, orgId, co.id), transfer(co, orgId, owner.id)])
    expect(Object.values(await roles(orgId))).toContain('owner')
  })

  describe('my-roles', () => {
    it('owner may assign every role and transfer; manager below itself; member nothing; outsider 404', async () => {
      const { owner, orgId, add } = await setup()
      const manager = await add('manager')
      const member = await add('member')
      expect(await local.myRolesLocal(db, ev(owner), orgId)).toEqual({
        role: 'owner',
        assignable: ['billing', 'member', 'admin', 'manager', 'owner'],
        mayTransferOwnership: true,
      })
      expect(await local.myRolesLocal(db, ev(manager), orgId)).toEqual({
        role: 'manager',
        assignable: ['billing', 'member', 'admin'],
        mayTransferOwnership: false,
      })
      expect(await local.myRolesLocal(db, ev(member), orgId)).toMatchObject({ assignable: [] })
      expect(await status(local.myRolesLocal(db, ev(await user()), orgId))).toBe(404)
    })
  })
})
