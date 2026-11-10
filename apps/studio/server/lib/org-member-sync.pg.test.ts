import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Comparing auth's members with org_member, the fail-closed repair, and the
// one-time backfill, against a REAL Postgres. Auth is a fake source here. Same
// guard as the other *.pg suites; `test:coverage` excludes it by name.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
type Lib = typeof import('./org-member-sync')
let db: Db
let schema: typeof import('~~/server/db/schema')
let lib: Lib

const a = `oms-${randomUUID()}`
const b = `oms-${randomUUID()}`
const gone = `oms-${randomUUID()}`
const ORGS = [a, b, gone]
// The test database is shared with the other *.pg suites running in parallel.
// A complete listing judges every org it covers, so these runs are limited to
// this file's orgs; without it they would delete the other suites' rows.
const ours = (orgId: string) => ORGS.includes(orgId)

type AuthOrg = import('./org-member-sync').AuthOrg
let authOrgs: AuthOrg[]
let complete: boolean
let reread: (orgId: string) => AuthOrg | null | Promise<AuthOrg | null>

// A complete listing here carries the independent count a real source must
// give; `countOverride` lets a cell give a wrong one.
let countOverride: number | undefined | null
// Each org's member list is proven complete unless a cell says otherwise, the
// way a real source must prove it (signal plus an independent count).
const prove = (o: AuthOrg | null): AuthOrg | null =>
  o && {
    ...o,
    membersComplete: o.membersComplete ?? true,
    memberCount: o.memberCount ?? o.members.length,
  }
const source = {
  listOrgs: async () => ({
    orgs: authOrgs.map((o) => prove(o)!),
    complete,
    expectedCount: countOverride === null ? undefined : (countOverride ?? authOrgs.length),
  }),
  readOrg: async (orgId: string) => prove(await reread(orgId)),
}

async function put(orgId: string, userId: string, role: string) {
  await db.insert(schema.orgMember).values({ organizationId: orgId, userId, role })
}

async function rows(orgId: string) {
  return (
    await db
      .select({ userId: schema.orgMember.userId, role: schema.orgMember.role })
      .from(schema.orgMember)
      .where(eq(schema.orgMember.organizationId, orgId))
  ).sort((x, y) => x.userId.localeCompare(y.userId))
}

describe.skipIf(!DATABASE_URL)('org member sync (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    lib = await import('./org-member-sync')
  })

  beforeEach(async () => {
    await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, ORGS))
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, ORGS))
    authOrgs = []
    complete = true
    countOverride = undefined
    reread = (orgId) => authOrgs.find((o) => o.orgId === orgId) ?? null
  })

  afterAll(async () => {
    if (!db) return
    await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, ORGS))
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, ORGS))
    await db.$client.end()
  })

  describe('heldRole: only roles actually held, the highest by rank', () => {
    it.each([
      ['member', 'member'],
      ['admin,member', 'admin'],
      ['billing, owner', 'owner'],
      ['member,root', 'member'],
      ['root', null],
      ['', null],
    ])('%j → %j', (raw, held) => {
      expect(lib.heldRole(raw)).toBe(held)
    })
  })

  describe('compare (report only)', () => {
    it('names every kind of difference and changes nothing', async () => {
      await put(a, 'same', 'admin')
      await put(a, 'stale', 'member')
      await put(a, 'higher', 'manager')
      authOrgs = [
        {
          orgId: a,
          members: [
            { userId: 'same', role: 'admin' },
            { userId: 'higher', role: 'member' },
            { userId: 'new', role: 'billing' },
            { userId: 'odd', role: 'root' },
          ],
        },
      ]
      const r = await lib.compareOrgMembers(db, source, { repair: false, scope: ours })
      expect(r.differences.map((d) => `${d.kind}:${d.userId}`).sort()).toEqual([
        'missing:new',
        'role_differs:higher',
        'stale:stale',
        'unknown_role:odd',
      ])
      expect(r.deleted).toEqual([])
      expect((await rows(a)).length).toBe(3)
    })
  })

  describe('repair: only what makes studio hold LESS', () => {
    it('deletes a stale row and a role above auth’s; inserts and raises nothing', async () => {
      await put(a, 'stale', 'member')
      await put(a, 'higher', 'manager')
      await put(a, 'lower', 'member')
      await put(a, 'same', 'admin')
      authOrgs = [
        {
          orgId: a,
          members: [
            { userId: 'higher', role: 'member' },
            { userId: 'lower', role: 'owner' },
            { userId: 'same', role: 'admin' },
            { userId: 'new', role: 'admin' },
          ],
        },
      ]
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 50,
      })
      expect(r.deleted.map((d) => d.userId).sort()).toEqual(['higher', 'stale'])
      // `lower` stays member (raising it would grant), `new` stays absent.
      expect(await rows(a)).toEqual([
        { userId: 'lower', role: 'member' },
        { userId: 'same', role: 'admin' },
      ])
    })

    // billing ranks lowest but holds the billing right no other role below
    // owner has: billing next to member must go, member next to billing too.
    it('billing against member exceeds in both directions', async () => {
      await put(a, 'u1', 'billing')
      await put(a, 'u2', 'member')
      authOrgs = [
        {
          orgId: a,
          members: [
            { userId: 'u1', role: 'member' },
            { userId: 'u2', role: 'billing' },
          ],
        },
      ]
      await lib.compareOrgMembers(db, source, { repair: true, scope: ours, maxDeletions: 50 })
      expect(await rows(a)).toEqual([])
    })

    it('an org studio has rows for but auth does not list: deleted when the listing is complete', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      complete = true
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 50,
      })
      expect(r.deleted).toEqual([{ orgId: gone, userId: 'u1', studioRole: 'owner' }])
    })

    it('an org outside the run’s scope is not judged, even with a complete listing', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: (id) => id === a,
        maxDeletions: 50,
      })
      expect(r.deleted).toEqual([])
      expect(await rows(gone)).toEqual([{ userId: 'u1', role: 'owner' }])
    })

    // 🔴 A WRONG "complete" deletes every org it leaves out, so complete needs
    // the source's signal AND a matching independent count.
    it('complete=true with no independent count: treated as incomplete, nothing unlisted judged', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      countOverride = null
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 50,
      })
      expect(r.complete).toBe(false)
      expect(await rows(gone)).toEqual([{ userId: 'u1', role: 'owner' }])
    })

    it('complete=true with a count that does not match what was read: incomplete', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      countOverride = 3
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 50,
      })
      expect(r.complete).toBe(false)
      expect(r.deleted).toEqual([])
    })

    it('a missing org with a proven-complete listing UNDER the cap: deleted', async () => {
      await put(gone, 'u1', 'owner')
      await put(gone, 'u2', 'member')
      authOrgs = []
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 2,
      })
      expect(r.refused).toBeUndefined()
      expect(r.deleted.map((d) => d.userId).sort()).toEqual(['u1', 'u2'])
    })

    it('the same OVER the cap: refuses, deletes nothing, reports what it would have', async () => {
      await put(gone, 'u1', 'owner')
      await put(gone, 'u2', 'member')
      authOrgs = []
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 1,
      })
      expect(r.refused).toEqual({ planned: 2, maxDeletions: 1 })
      expect(r.deleted).toEqual([])
      expect((await rows(gone)).length).toBe(2)
    })

    // 🔴 A missing org in an INCOMPLETE listing proves nothing.
    it('the same org with an incomplete listing: not judged, not deleted', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      complete = false
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 50,
      })
      expect(r.complete).toBe(false)
      expect(r.deleted).toEqual([])
      expect(await rows(gone)).toEqual([{ userId: 'u1', role: 'owner' }])
    })

    // The repair re-reads auth under the org's lock: a member a route added
    // after the listing is not deleted as stale.
    it('judges by auth as it is under the lock, not by the earlier listing', async () => {
      await put(a, 'late', 'member')
      authOrgs = [{ orgId: a, members: [] }]
      reread = () => ({ orgId: a, members: [{ userId: 'late', role: 'member' }] })
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        scope: ours,
        maxDeletions: 50,
      })
      expect(r.deleted).toEqual([])
      expect(await rows(a)).toEqual([{ userId: 'late', role: 'member' }])
    })
  })

  describe('backfill (D-E1)', () => {
    beforeEach(() => {
      authOrgs = [
        {
          orgId: a,
          members: [
            { userId: 'u-owner', role: 'owner' },
            { userId: 'u-multi', role: 'admin,member' },
            { userId: 'u-odd', role: 'root' },
            { userId: 'u-have', role: 'admin' },
          ],
        },
        { orgId: b, members: [{ userId: 'u-b', role: 'billing' }] },
      ]
    })

    it('a dry run writes nothing and counts what it would do', async () => {
      await put(a, 'u-have', 'member')
      const c = await lib.backfillOrgMembers(db, source, { dryRun: true })
      expect(c).toEqual({
        dryRun: true,
        complete: true,
        orgs: 2,
        membersRead: 5,
        inserted: 3,
        existing: 1,
        skippedUnknownRole: 1,
        multipleRoles: 1,
        removedAfterReread: 0,
        busyOrgs: [],
        unproven: [],
      })
      expect(await rows(a)).toEqual([{ userId: 'u-have', role: 'member' }])
      expect(await rows(b)).toEqual([])
    })

    it('a real run inserts held roles only and never overwrites a row', async () => {
      await put(a, 'u-have', 'member')
      await lib.backfillOrgMembers(db, source, { dryRun: false })
      expect(await rows(a)).toEqual([
        { userId: 'u-have', role: 'member' },
        { userId: 'u-multi', role: 'admin' },
        { userId: 'u-owner', role: 'owner' },
      ])
      expect(await rows(b)).toEqual([{ userId: 'u-b', role: 'billing' }])
    })

    it('is idempotent: a second run inserts nothing', async () => {
      await lib.backfillOrgMembers(db, source, { dryRun: false })
      const again = await lib.backfillOrgMembers(db, source, { dryRun: false })
      expect(again.inserted).toBe(0)
      expect(again.existing).toBe(4)
    })

    // 🔴 A member removed (or demoted) between the listing and the insert must
    // not come back: the second read of auth decides.
    it('a row the second read does not confirm is removed again', async () => {
      reread = (orgId) =>
        orgId === a
          ? {
              orgId: a,
              members: [
                { userId: 'u-multi', role: 'member' },
                { userId: 'u-have', role: 'admin' },
              ],
            }
          : (authOrgs.find((o) => o.orgId === orgId) ?? null)
      const c = await lib.backfillOrgMembers(db, source, { dryRun: false })
      expect(c.removedAfterReread).toBe(2)
      // u-owner gone from auth, u-multi demoted to member: neither is kept.
      expect(await rows(a)).toEqual([{ userId: 'u-have', role: 'admin' }])
    })

    it.each([
      ['complete=false', () => (complete = false)],
      ['no independent count', () => (countOverride = null)],
      ['a count that does not match', () => (countOverride = 3)],
    ])('a real run with %s refuses before writing anything', async (_, flip) => {
      flip()
      await expect(lib.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
        lib.BackfillRefused,
      )
      expect(await rows(a)).toEqual([])
      expect(await rows(b)).toEqual([])
    })

    it('an org whose member list is not proven is skipped and named; the other is loaded', async () => {
      authOrgs[0] = { ...authOrgs[0]!, membersComplete: false }
      const c = await lib.backfillOrgMembers(db, source, { dryRun: false })
      expect(c.unproven).toEqual([a])
      expect(await rows(a)).toEqual([])
      expect(await rows(b)).toEqual([{ userId: 'u-b', role: 'billing' }])
    })

    it('a second read that fails removes what was just inserted for that org, and stops', async () => {
      reread = () => {
        throw new Error('second read failed')
      }
      await expect(lib.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
        'second read failed',
      )
      expect(await rows(a)).toEqual([])
      expect(await rows(b)).toEqual([])
    })
  })

  // Sikkerhed C2: the sync takes the same lock as the routes, so it must not
  // be able to empty the pool either.
  it('pool size + 1 concurrent repair runs: an unrelated query is answered, all settle', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    await put(a, 'u1', 'member')
    authOrgs = [{ orgId: a, members: [{ userId: 'u1', role: 'member' }] }]
    reread = () => sleep(150).then(() => authOrgs[0]!)
    const runs = Array.from({ length: 11 }, () =>
      lib
        .compareOrgMembers(db, source, { repair: true, scope: ours, maxDeletions: 50 })
        .catch((e: unknown) => e),
    )
    const unrelated = await Promise.race([
      db.execute(sql`select 1`).then(() => 'answered'),
      sleep(2_000).then(() => 'hung'),
    ])
    expect(unrelated).toBe('answered')
    const results = await Promise.all(runs)
    for (const r of results) {
      if (r && typeof r === 'object' && 'data' in r) {
        expect((r as { data?: { code?: string } }).data?.code).toBe('org_write_busy')
      } else {
        expect(r).toMatchObject({ complete: true })
      }
    }
    expect(await rows(a)).toEqual([{ userId: 'u1', role: 'member' }])
  })

  // 🔴 SIKKERHED C1 on #391 (their probe T): the org LISTING is complete but one
  // org's member list is not; a member missing from it is a current member.
  describe('C1: an org whose member list is not proven is reported, never repaired', () => {
    const repair = (max = 50) =>
      lib.compareOrgMembers(db, source, { repair: true, scope: ours, maxDeletions: max })

    it('membersComplete missing: the member auth did not list is NOT deleted', async () => {
      await put(a, 'listed', 'member')
      await put(a, 'b', 'member')
      authOrgs = [
        {
          orgId: a,
          members: [{ userId: 'listed', role: 'member' }],
          membersComplete: false,
        },
      ]
      const r = await repair()
      expect(r.deleted).toEqual([])
      expect(r.unproven).toEqual([a])
      expect(r.differences.map((d) => `${d.kind}:${d.userId}`)).toEqual(['stale:b'])
      expect((await rows(a)).map((x) => x.userId)).toEqual(['b', 'listed'])
    })

    it('a member count that does not match the list: NOT deleted', async () => {
      await put(a, 'listed', 'member')
      await put(a, 'b', 'member')
      authOrgs = [{ orgId: a, members: [{ userId: 'listed', role: 'member' }], memberCount: 2 }]
      const r = await repair()
      expect(r.deleted).toEqual([])
      expect(r.unproven).toEqual([a])
    })

    it('a list that loses its proof between the passes: NOT deleted (checked under the lock)', async () => {
      await put(a, 'b', 'member')
      authOrgs = [{ orgId: a, members: [] }]
      reread = () => ({ orgId: a, members: [], membersComplete: false })
      const r = await repair()
      expect(r.deleted).toEqual([])
      expect(r.unproven).toEqual([a])
    })
  })

  // Sikkerhed A1 on #391 (their probe M): auth may hold several roles.
  it('studio billing against auth "billing,member": the same, nothing deleted', async () => {
    await put(a, 'c', 'billing')
    authOrgs = [{ orgId: a, members: [{ userId: 'c', role: 'billing,member' }] }]
    const r = await lib.compareOrgMembers(db, source, {
      repair: true,
      scope: ours,
      maxDeletions: 50,
    })
    expect(r.differences).toEqual([])
    expect(r.deleted).toEqual([])
    expect(await rows(a)).toEqual([{ userId: 'c', role: 'billing' }])
  })

  it('studio admin against auth "billing,member": exceeds every one of them, deleted', async () => {
    await put(a, 'c', 'admin')
    authOrgs = [{ orgId: a, members: [{ userId: 'c', role: 'billing,member' }] }]
    const r = await lib.compareOrgMembers(db, source, {
      repair: true,
      scope: ours,
      maxDeletions: 50,
    })
    expect(r.deleted.map((d) => d.userId)).toEqual(['c'])
  })

  // Sikkerhed A3 on #391: over the cap NOTHING is deleted, across orgs too.
  it('one deletion in each of two orgs with a cap of 1: refused, nothing deleted anywhere', async () => {
    await put(a, 'x', 'member')
    await put(b, 'y', 'member')
    authOrgs = [
      { orgId: a, members: [] },
      { orgId: b, members: [] },
    ]
    const r = await lib.compareOrgMembers(db, source, {
      repair: true,
      scope: ours,
      maxDeletions: 1,
    })
    expect(r.refused).toEqual({ planned: 2, maxDeletions: 1 })
    expect(r.deleted).toEqual([])
    expect(await rows(a)).toEqual([{ userId: 'x', role: 'member' }])
    expect(await rows(b)).toEqual([{ userId: 'y', role: 'member' }])
  })

  // Sikkerhed A2 on #391: every change the sync makes leaves an audit row.
  it('repair and backfill write audit rows in the same transaction as the change', async () => {
    await put(a, 'stale', 'member')
    authOrgs = [{ orgId: a, members: [] }]
    await lib.compareOrgMembers(db, source, { repair: true, scope: ours, maxDeletions: 50 })
    authOrgs = [{ orgId: b, members: [{ userId: 'new', role: 'admin' }] }]
    await lib.backfillOrgMembers(db, source, { dryRun: false })
    const audit = await db
      .select({
        org: schema.auditLog.organizationId,
        action: schema.auditLog.action,
        target: schema.auditLog.targetId,
      })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.organizationId, ORGS))
    expect(audit.sort((x, y) => x.action.localeCompare(y.action))).toEqual([
      { org: b, action: 'member.backfilled', target: 'new' },
      { org: a, action: 'member.sync_removed', target: 'stale' },
    ])
  })

  // A busy org must not end the run and lose the report.
  it('an org busy with another write is named in the report; the other org is repaired', async () => {
    await put(a, 'x', 'member')
    await put(b, 'y', 'member')
    authOrgs = [
      { orgId: a, members: [] },
      { orgId: b, members: [] },
    ]
    let release!: () => void
    // Hold org a the way a route's write would.
    const { withOrgLockOn } = await import('./org-membership')
    const holding = withOrgLockOn(db, a, () => new Promise<void>((r) => (release = r)))
    await new Promise((r) => setTimeout(r, 100))
    const r = await lib.compareOrgMembers(db, source, {
      repair: true,
      scope: ours,
      maxDeletions: 50,
    })
    release()
    await holding
    expect(r.busy).toEqual([a])
    expect(r.deleted.map((d) => d.userId)).toEqual(['y'])
    expect(r.differences.map((d) => `${d.kind}:${d.userId}`).sort()).toEqual(['stale:x', 'stale:y'])
    expect(await rows(a)).toEqual([{ userId: 'x', role: 'member' }])
  }, 15_000)
})
