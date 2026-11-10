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

const source = {
  listOrgs: async () => ({ orgs: authOrgs, complete }),
  readOrg: async (orgId: string) => await reread(orgId),
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
    authOrgs = []
    complete = true
    reread = (orgId) => authOrgs.find((o) => o.orgId === orgId) ?? null
  })

  afterAll(async () => {
    if (!db) return
    await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, ORGS))
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
      const r = await lib.compareOrgMembers(db, source, { repair: false, only: ours })
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
      const r = await lib.compareOrgMembers(db, source, { repair: true, only: ours })
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
      await lib.compareOrgMembers(db, source, { repair: true, only: ours })
      expect(await rows(a)).toEqual([])
    })

    it('an org studio has rows for but auth does not list: deleted when the listing is complete', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      complete = true
      const r = await lib.compareOrgMembers(db, source, { repair: true, only: ours })
      expect(r.deleted).toEqual([{ orgId: gone, userId: 'u1', studioRole: 'owner' }])
    })

    it('an org outside the run’s scope is not judged, even with a complete listing', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      const r = await lib.compareOrgMembers(db, source, {
        repair: true,
        only: (id) => id === a,
      })
      expect(r.deleted).toEqual([])
      expect(await rows(gone)).toEqual([{ userId: 'u1', role: 'owner' }])
    })

    // 🔴 A missing org in an INCOMPLETE listing proves nothing.
    it('the same org with an incomplete listing: not judged, not deleted', async () => {
      await put(gone, 'u1', 'owner')
      authOrgs = []
      complete = false
      const r = await lib.compareOrgMembers(db, source, { repair: true, only: ours })
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
      const r = await lib.compareOrgMembers(db, source, { repair: true, only: ours })
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
  })

  // Sikkerhed C2: the sync takes the same lock as the routes, so it must not
  // be able to empty the pool either.
  it('pool size + 1 concurrent repair runs: an unrelated query is answered, all settle', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    await put(a, 'u1', 'member')
    authOrgs = [{ orgId: a, members: [{ userId: 'u1', role: 'member' }] }]
    reread = () => sleep(150).then(() => authOrgs[0]!)
    const runs = Array.from({ length: 11 }, () =>
      lib.compareOrgMembers(db, source, { repair: true, only: ours }).catch((e: unknown) => e),
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
})
