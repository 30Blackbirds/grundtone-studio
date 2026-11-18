import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseRoleMapping } from './config'

// Org roles from an IdP claim, against a REAL Postgres. Denials first: the
// claim never touches a member Studio assigned, never makes or unmakes an
// owner, never reaches an organisation it does not name, and a role changed in
// Studio stops being the claim's.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let sync: typeof import('./claim-roles')
let orgs: typeof import('../local-orgs')

const userIds: string[] = []
const orgIds: string[] = []

describe.skipIf(!DATABASE_URL)('claim -> org role sync (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    sync = await import('./claim-roles')
    orgs = await import('../local-orgs')
  })
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

  async function user() {
    const id = randomUUID()
    userIds.push(id)
    await db
      .insert(schema.appUser)
      .values({ id, email: `u-${id.slice(0, 8)}@example.com`, emailVerified: true })
    return { id, email: `u-${id.slice(0, 8)}@example.com` }
  }
  async function org() {
    const owner = await user()
    const slug = `claim-${randomUUID().slice(0, 8)}`
    const o = await orgs.createOrganization(db, owner, { name: 'Acme', slug })
    orgIds.push(o.id)
    return { ...o, owner }
  }
  const roleIn = async (orgId: string, userId: string) =>
    (
      await db
        .select({ role: schema.orgMember.role })
        .from(schema.orgMember)
        .where(and(eq(schema.orgMember.organizationId, orgId), eq(schema.orgMember.userId, userId)))
    )[0]?.role ?? null
  const marked = async (orgId: string, userId: string) =>
    (
      await db
        .select()
        .from(schema.orgMemberClaim)
        .where(
          and(
            eq(schema.orgMemberClaim.organizationId, orgId),
            eq(schema.orgMemberClaim.userId, userId),
          ),
        )
    ).length === 1

  describe('denials', () => {
    it('a member assigned in Studio is never changed or removed by the claim', async () => {
      const a = await org()
      const u = await user()
      await db
        .insert(schema.orgMember)
        .values({ organizationId: a.id, userId: u.id, role: 'member' })
      const m = parseRoleMapping('groups', `admins=${a.slug}:admin`)!
      await sync.syncClaimRoles(db, m, u.id, ['admins'])
      expect(await roleIn(a.id, u.id)).toBe('member')
      await sync.syncClaimRoles(db, m, u.id, [])
      expect(await roleIn(a.id, u.id)).toBe('member')
    })

    it('an owner is never touched, even one the claim also names', async () => {
      const a = await org()
      const m = parseRoleMapping('groups', `admins=${a.slug}:member`)!
      // Even if the row carries a claim marker (it can, once a claim member is
      // handed ownership), an owner is left alone.
      await db.insert(schema.orgMemberClaim).values({ organizationId: a.id, userId: a.owner.id })
      await sync.syncClaimRoles(db, m, a.owner.id, ['admins'])
      expect(await roleIn(a.id, a.owner.id)).toBe('owner')
      await sync.syncClaimRoles(db, m, a.owner.id, [])
      expect(await roleIn(a.id, a.owner.id)).toBe('owner')
    })

    it('values not in the map grant nothing, and an unknown org slug is ignored', async () => {
      const a = await org()
      const u = await user()
      const m = parseRoleMapping('groups', `admins=${a.slug}:admin,ghosts=no-such-org:admin`)!
      expect(await sync.syncClaimRoles(db, m, u.id, ['everyone', 'ghosts'])).toEqual({
        added: [],
        changed: [],
        removed: [],
      })
      expect(await roleIn(a.id, u.id)).toBeNull()
    })

    it('another organisation, not in the map, is never reached', async () => {
      const a = await org()
      const b = await org()
      const u = await user()
      await db
        .insert(schema.orgMember)
        .values({ organizationId: b.id, userId: u.id, role: 'admin' })
      const m = parseRoleMapping('groups', `admins=${a.slug}:admin`)!
      await sync.syncClaimRoles(db, m, u.id, ['admins'])
      await sync.syncClaimRoles(db, m, u.id, [])
      expect(await roleIn(b.id, u.id)).toBe('admin')
    })
  })

  it('grants, upgrades to the highest named role, and withdraws when the value is gone', async () => {
    const a = await org()
    const u = await user()
    const m = parseRoleMapping('groups', `staff=${a.slug}:member,leads=${a.slug}:manager`)!
    expect((await sync.syncClaimRoles(db, m, u.id, ['staff'])).added).toEqual([a.id])
    expect(await roleIn(a.id, u.id)).toBe('member')
    expect(await marked(a.id, u.id)).toBe(true)
    expect((await sync.syncClaimRoles(db, m, u.id, ['staff', 'leads'])).changed).toEqual([a.id])
    expect(await roleIn(a.id, u.id)).toBe('manager')
    expect((await sync.syncClaimRoles(db, m, u.id, [])).removed).toEqual([a.id])
    expect(await roleIn(a.id, u.id)).toBeNull()
    expect(await marked(a.id, u.id)).toBe(false)
    const audit = await db
      .select({ action: schema.auditLog.action, actorEmail: schema.auditLog.actorEmail })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.organizationId, a.id), eq(schema.auditLog.targetId, u.id)))
    expect(audit.map((r) => r.action).sort()).toEqual([
      'member.added',
      'member.removed',
      'member.role_changed',
    ])
    expect(new Set(audit.map((r) => r.actorEmail))).toEqual(new Set(['idp-claim']))
  })

  it('Studio wins: a role changed in Studio stops being managed by the claim', async () => {
    const a = await org()
    const u = await user()
    const m = parseRoleMapping('groups', `staff=${a.slug}:member`)!
    await sync.syncClaimRoles(db, m, u.id, ['staff'])
    await orgs.changeMemberRole(db, a.owner, a.id, u.id, 'admin')
    expect(await marked(a.id, u.id)).toBe(false)
    await sync.syncClaimRoles(db, m, u.id, [])
    expect(await roleIn(a.id, u.id)).toBe('admin')
  })

  it("an accepted invitation also makes the row Studio's", async () => {
    const a = await org()
    const u = await user()
    const m = parseRoleMapping('groups', `staff=${a.slug}:member`)!
    await sync.syncClaimRoles(db, m, u.id, ['staff'])
    const inv = await orgs.createInvitation(db, a.owner, a.id, { email: u.email, role: 'billing' })
    await orgs.acceptInvitation(db, { ...u, emailVerified: true }, inv.token, {
      requireEmailVerified: true,
    })
    expect(await marked(a.id, u.id)).toBe(false)
    await sync.syncClaimRoles(db, m, u.id, [])
    expect(await roleIn(a.id, u.id)).toBe('member')
  })
})
