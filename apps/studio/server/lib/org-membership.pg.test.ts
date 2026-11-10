import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipDeps } from './org-membership'

// The write ORDER of org-membership.ts against a REAL Postgres: what is left in
// org_member when auth says yes, refuses, or never answers, and when studio's
// own commit fails after auth said yes. Auth is a fake here; the transaction,
// the rollback and the constraints are real. Same guard as the other *.pg
// suites; `test:coverage` excludes it by name.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
type Lib = typeof import('./org-membership')
let db: Db
let schema: typeof import('~~/server/db/schema')
let lib: Lib

const org = `om-${randomUUID()}`
const otherOrg = `om-${randomUUID()}`
const event = null as never

let auth: ReturnType<typeof vi.fn>
let members: Array<{ id: string; userId: string; role: string }>
let failAudit = false
let invitationOrgId: string | null = null

function deps(over: Partial<MembershipDeps> = {}): MembershipDeps {
  return {
    db,
    auth: auth as unknown as MembershipDeps['auth'],
    invitationOrg: async () => invitationOrgId,
    members: async () => members,
    audit: async (exec, row) => {
      if (failAudit) throw new Error('commit refused (test)')
      await exec.insert(schema.auditLog).values(row)
    },
    ...over,
  }
}

const refused = () => new lib.AuthRefused(403, { message: 'no', code: 'FORBIDDEN' })
const unknown = () => new lib.AuthOutcomeUnknown('timeout')

async function roleOf(o: string, userId: string) {
  const [row] = await db
    .select({ role: schema.orgMember.role })
    .from(schema.orgMember)
    .where(and(eq(schema.orgMember.organizationId, o), eq(schema.orgMember.userId, userId)))
  return row?.role ?? null
}

async function put(o: string, userId: string, role: string) {
  await db
    .insert(schema.orgMember)
    .values({ organizationId: o, userId, role })
    .onConflictDoUpdate({
      target: [schema.orgMember.organizationId, schema.orgMember.userId],
      set: { role },
    })
}

async function auditActions(o: string) {
  return (
    await db
      .select({ action: schema.auditLog.action, after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, o))
  ).map((r) => r)
}

describe.skipIf(!DATABASE_URL)('org membership writes (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    lib = await import('./org-membership')
  })

  beforeEach(async () => {
    failAudit = false
    invitationOrgId = org
    auth = vi.fn()
    members = []
    for (const o of [org, otherOrg]) {
      await db.delete(schema.orgMember).where(eq(schema.orgMember.organizationId, o))
      await db.delete(schema.auditLog).where(eq(schema.auditLog.organizationId, o))
    }
  })

  afterAll(async () => {
    if (!db) return
    for (const o of [org, otherOrg]) {
      await db.delete(schema.orgMember).where(eq(schema.orgMember.organizationId, o))
      await db.delete(schema.auditLog).where(eq(schema.auditLog.organizationId, o))
    }
    await db.$client.end()
  })

  describe('grant: accept invitation', () => {
    const answer = { member: { userId: 'u-new', organizationId: org, role: 'admin' } }

    it('auth says yes: the row holds the role AUTH returned, with its audit row', async () => {
      auth.mockResolvedValue(answer)
      await lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')
      expect(auth).toHaveBeenCalledWith('accept-invitation', { invitationId: 'inv-1' })
      expect(await roleOf(org, 'u-new')).toBe('admin')
      expect((await auditActions(org)).map((a) => a.action)).toEqual(['member.invite_accepted'])
    })

    it('a second accept of the same invitation is idempotent', async () => {
      auth.mockResolvedValue(answer)
      await lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')
      await lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')
      expect(await roleOf(org, 'u-new')).toBe('admin')
    })

    it('auth refuses: nothing is written, and the caller gets auth’s status', async () => {
      auth.mockRejectedValue(refused())
      await expect(lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')).rejects.toMatchObject({
        statusCode: 403,
      })
      expect(await roleOf(org, 'u-new')).toBeNull()
    })

    it('auth never answers: nothing is written (502 auth_unavailable)', async () => {
      auth.mockRejectedValue(unknown())
      await expect(lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')).rejects.toMatchObject({
        statusCode: 502,
        data: { code: 'auth_unavailable' },
      })
      expect(await roleOf(org, 'u-new')).toBeNull()
    })

    // 🔴 The member auth names must be the caller, or studio would record a
    // role for someone else on the caller's request.
    it('auth answers for another user: nothing is written', async () => {
      auth.mockResolvedValue({ member: { ...answer.member, userId: 'someone-else' } })
      await expect(lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')).rejects.toMatchObject({
        statusCode: 502,
      })
      expect(await roleOf(org, 'someone-else')).toBeNull()
      expect(await roleOf(org, 'u-new')).toBeNull()
    })

    it('the accepted member names another org than the invitation: nothing is written', async () => {
      auth.mockResolvedValue({ member: { ...answer.member, organizationId: otherOrg } })
      await expect(lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')).rejects.toMatchObject({
        statusCode: 502,
      })
      expect(await roleOf(otherOrg, 'u-new')).toBeNull()
    })

    it('an invitation auth does not know is 404, and accept is never asked', async () => {
      invitationOrgId = null
      await expect(lib.acceptInvitation(deps(), event, 'u-new', 'inv-x')).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(auth).not.toHaveBeenCalled()
    })

    it('auth says yes and studio’s commit fails: no row, so studio denies (fail-closed)', async () => {
      auth.mockResolvedValue(answer)
      failAudit = true
      await expect(lib.acceptInvitation(deps(), event, 'u-new', 'inv-1')).rejects.toThrow()
      expect(await roleOf(org, 'u-new')).toBeNull()
    })
  })

  describe('grant: create organization', () => {
    it('the creator is recorded as owner of the org auth created', async () => {
      auth.mockResolvedValue({ id: org, name: 'Om' })
      await lib.createOrganization(deps(), event, 'u-creator', { name: 'Om', slug: 'om' })
      expect(await roleOf(org, 'u-creator')).toBe('owner')
    })

    it('auth refuses: no row', async () => {
      auth.mockRejectedValue(refused())
      await expect(
        lib.createOrganization(deps(), event, 'u-creator', { name: 'Om', slug: 'om' }),
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(await roleOf(org, 'u-creator')).toBeNull()
    })
  })

  describe('revoke: remove member', () => {
    beforeEach(async () => {
      await put(org, 'u-gone', 'member')
      members = [{ id: 'm-gone', userId: 'u-gone', role: 'member' }]
    })

    it('auth says yes: the row is gone', async () => {
      auth.mockResolvedValue({ member: {} })
      await lib.removeMember(deps(), event, 'owner', org, 'm-gone')
      expect(auth).toHaveBeenCalledWith('remove-member', {
        memberIdOrEmail: 'm-gone',
        organizationId: org,
      })
      expect(await roleOf(org, 'u-gone')).toBeNull()
    })

    it('auth refuses: the removed row is put back', async () => {
      auth.mockRejectedValue(refused())
      await expect(lib.removeMember(deps(), event, 'owner', org, 'm-gone')).rejects.toMatchObject({
        statusCode: 403,
      })
      expect(await roleOf(org, 'u-gone')).toBe('member')
    })

    // 🔴 The direction that matters: an unknown answer must leave studio
    // DENYING, not allowing what auth may already have removed.
    it('auth never answers: the row is gone anyway, and the caller gets auth_pending', async () => {
      auth.mockRejectedValue(unknown())
      await expect(lib.removeMember(deps(), event, 'owner', org, 'm-gone')).rejects.toMatchObject({
        statusCode: 502,
        data: { code: 'auth_pending' },
      })
      expect(await roleOf(org, 'u-gone')).toBeNull()
      expect(await auditActions(org)).toEqual([
        { action: 'member.removed', after: { authPending: true } },
      ])
    })

    // 🔴 THE ORDER ITSELF: when auth is asked, studio has already committed
    // the removal. No answer from auth can leave the row in place.
    it('the row is gone and committed BEFORE auth is asked', async () => {
      let rowWhenAsked: string | null = 'not asked'
      auth.mockImplementation(async () => {
        rowWhenAsked = await roleOf(org, 'u-gone')
        return { member: {} }
      })
      await lib.removeMember(deps(), event, 'owner', org, 'm-gone')
      expect(rowWhenAsked).toBeNull()
    })

    it('auth says yes and studio’s audit write fails: row stays gone (500, closed)', async () => {
      auth.mockResolvedValue({ member: {} })
      failAudit = true
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(lib.removeMember(deps(), event, 'owner', org, 'm-gone')).rejects.toMatchObject({
        statusCode: 500,
        data: { code: 'org_member_not_recorded' },
      })
      expect(await roleOf(org, 'u-gone')).toBeNull()
    })

    it('auth refuses and putting the row back fails: too little access, never more', async () => {
      auth.mockRejectedValue(refused())
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // The restore runs on the locked connection; make its insert fail there.
      const noInsert = (locked: Db) =>
        new Proxy(locked, {
          get: (t, k) =>
            k === 'insert'
              ? () => {
                  throw new Error('insert refused (test)')
                }
              : Reflect.get(t, k),
        })
      await expect(
        lib.removeMember(deps({ onLocked: noInsert }), event, 'owner', org, 'm-gone'),
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(await roleOf(org, 'u-gone')).toBeNull()
    })

    it('a manager may not remove another manager: refused before auth is asked', async () => {
      await put(org, 'u-gone', 'manager')
      members = [{ id: 'm-gone', userId: 'u-gone', role: 'manager' }]
      await expect(lib.removeMember(deps(), event, 'manager', org, 'm-gone')).rejects.toMatchObject(
        { statusCode: 403 },
      )
      expect(auth).not.toHaveBeenCalled()
      expect(await roleOf(org, 'u-gone')).toBe('manager')
    })

    it('a member id auth does not know is 404, and nothing is asked or written', async () => {
      await expect(lib.removeMember(deps(), event, 'owner', org, 'm-nope')).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(auth).not.toHaveBeenCalled()
    })
  })

  describe('role change: the direction picks the order', () => {
    const change = (from: string, to: string) => {
      members = [{ id: 'm-x', userId: 'u-x', role: from }]
      return lib.changeMemberRole(deps(), event, 'owner', org, 'm-x', to as never)
    }

    it('a demotion with an unknown answer leaves NO row: closed, not the new role', async () => {
      await put(org, 'u-x', 'manager')
      auth.mockRejectedValue(unknown())
      await expect(change('manager', 'member')).rejects.toMatchObject({
        data: { code: 'auth_pending' },
      })
      expect(await roleOf(org, 'u-x')).toBeNull()
    })

    // admin -> billing gains billing but loses project view: a lateral move is
    // a revoke, so an unknown answer must not leave billing behind either.
    it('a lateral change (admin -> billing) takes the revoke path', async () => {
      await put(org, 'u-x', 'admin')
      auth.mockRejectedValue(unknown())
      await expect(change('admin', 'billing')).rejects.toMatchObject({
        data: { code: 'auth_pending' },
      })
      expect(await roleOf(org, 'u-x')).toBeNull()
    })

    // admin -> billing GAINS billing: that right must not be held before auth
    // holds it, so while auth is asked the member has no row at all.
    it('a lateral change holds neither role while auth is asked, then the new one', async () => {
      await put(org, 'u-x', 'admin')
      let rowWhenAsked: string | null = 'not asked'
      auth.mockImplementation(async () => {
        rowWhenAsked = await roleOf(org, 'u-x')
        return { role: 'billing' }
      })
      await change('admin', 'billing')
      expect(rowWhenAsked).toBeNull()
      expect(await roleOf(org, 'u-x')).toBe('billing')
    })

    it('a demotion refused by auth puts the old role back', async () => {
      await put(org, 'u-x', 'manager')
      auth.mockRejectedValue(refused())
      await expect(change('manager', 'member')).rejects.toMatchObject({ statusCode: 403 })
      expect(await roleOf(org, 'u-x')).toBe('manager')
    })

    it('a promotion with an unknown answer leaves the OLD role: nothing was granted', async () => {
      await put(org, 'u-x', 'member')
      auth.mockRejectedValue(unknown())
      await expect(change('member', 'admin')).rejects.toMatchObject({
        data: { code: 'auth_unavailable' },
      })
      expect(await roleOf(org, 'u-x')).toBe('member')
    })

    it('auth says yes: the new role, either way', async () => {
      await put(org, 'u-x', 'member')
      auth.mockResolvedValue({ role: 'admin' })
      await change('member', 'admin')
      expect(await roleOf(org, 'u-x')).toBe('admin')
      auth.mockResolvedValue({ role: 'billing' })
      await change('admin', 'billing')
      expect(await roleOf(org, 'u-x')).toBe('billing')
    })

    // 🔴 SIKKERHED C1: a refused demotion must not put back a row that a
    // concurrent removal has since taken away in auth. A waits on auth with its
    // row removed; B removes the same member and gets auth's yes; then A is
    // refused. Without the per-org lock B runs in A's wait and A's restore
    // leaves `manager` behind; with it B waits for A, and the row ends gone.
    it('C1: a refused demotion racing a removal leaves NO row', async () => {
      await put(org, 'u-x', 'manager')
      members = [{ id: 'm-x', userId: 'u-x', role: 'manager' }]
      let refuseA!: (e: unknown) => void
      let aAsked!: () => void
      const aIsWaiting = new Promise<void>((r) => (aAsked = r))
      auth.mockImplementation((path: string) => {
        if (path === 'update-member-role') {
          aAsked()
          return new Promise((_, reject) => (refuseA = reject))
        }
        return Promise.resolve({ member: {} })
      })
      const a = lib
        .changeMemberRole(deps(), event, 'owner', org, 'm-x', 'member')
        .catch((e: unknown) => e)
      await aIsWaiting
      const b = lib.removeMember(deps(), event, 'owner', org, 'm-x').catch((e: unknown) => e)
      // Give B every chance to run inside A's wait if nothing stops it.
      await new Promise((r) => setTimeout(r, 300))
      refuseA(refused())
      const [ra, rb] = await Promise.all([a, b])
      expect(ra).toMatchObject({ statusCode: 403 })
      expect(rb).toEqual({ member: {} })
      expect(await roleOf(org, 'u-x')).toBeNull()
    })

    it('onlyAdds: admin manages members, so member -> admin only adds', () => {
      expect(lib.onlyAdds('member', 'admin')).toBe(true)
      expect(lib.onlyAdds('admin', 'member')).toBe(false)
    })

    it('onlyAdds: what counts as a grant', () => {
      expect(lib.onlyAdds('member', 'admin')).toBe(true)
      expect(lib.onlyAdds('admin', 'manager')).toBe(true)
      expect(lib.onlyAdds('manager', 'owner')).toBe(true)
      // manager has no billing right, so owner -> manager takes one away.
      expect(lib.onlyAdds('owner', 'manager')).toBe(false)
      expect(lib.onlyAdds('billing', 'member')).toBe(false)
      expect(lib.onlyAdds('admin', 'billing')).toBe(false)
    })
  })

  describe('revoke: leave and delete', () => {
    it('leave with an unknown answer: the row stays removed (auth fires no hook on leave)', async () => {
      await put(org, 'u-me', 'member')
      members = [{ id: 'm-me', userId: 'u-me', role: 'member' }]
      auth.mockRejectedValue(unknown())
      await expect(lib.leaveOrganization(deps(), event, 'u-me', org)).rejects.toMatchObject({
        data: { code: 'auth_pending' },
      })
      expect(await roleOf(org, 'u-me')).toBeNull()
    })

    it('leave removes only the caller’s row', async () => {
      await put(org, 'u-me', 'member')
      members = [{ id: 'm-me', userId: 'u-me', role: 'member' }]
      await put(org, 'u-other', 'member')
      auth.mockResolvedValue({})
      await lib.leaveOrganization(deps(), event, 'u-me', org)
      expect(await roleOf(org, 'u-me')).toBeNull()
      expect(await roleOf(org, 'u-other')).toBe('member')
    })

    it('delete removes every row of that org and none of another', async () => {
      await put(org, 'u-1', 'owner')
      await put(org, 'u-2', 'member')
      await put(otherOrg, 'u-1', 'owner')
      auth.mockResolvedValue({})
      await lib.deleteOrganization(deps(), event, org)
      expect(await roleOf(org, 'u-1')).toBeNull()
      expect(await roleOf(org, 'u-2')).toBeNull()
      expect(await roleOf(otherOrg, 'u-1')).toBe('owner')
    })

    it('delete refused by auth: every row stays', async () => {
      await put(org, 'u-1', 'owner')
      auth.mockRejectedValue(refused())
      await expect(lib.deleteOrganization(deps(), event, org)).rejects.toMatchObject({
        statusCode: 403,
      })
      expect(await roleOf(org, 'u-1')).toBe('owner')
    })
  })

  // 🔴 SIKKERHED C2: the lock must never be able to empty the pool. The test
  // process uses postgres.js defaults like production (max 10 connections).
  describe('C2: a burst cannot wedge the database', () => {
    const POOL = 10
    const limits = { maxConcurrent: 4, waitMs: 1_000 }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    /** Answers 'answered' if `select 1` returns within ms, else 'hung'. */
    const unrelatedQuery = (ms: number) =>
      Promise.race([db.execute(sql`select 1`).then(() => 'answered'), sleep(ms).then(() => 'hung')])

    const codeOf = (r: unknown) =>
      r && typeof r === 'object' && 'data' in r
        ? (r as { data?: { code?: string } }).data?.code
        : 'ok'

    it('pool size + 1 leaves on ONE org: an unrelated query is answered, all settle, the rest get 503 busy', async () => {
      const users = Array.from({ length: POOL + 1 }, (_, i) => `burst-${i}`)
      for (const u of users) await put(org, u, 'member')
      members = users.map((u) => ({ id: `m-${u}`, userId: u, role: 'member' }))
      auth.mockImplementation(() => sleep(150).then(() => ({})))
      const started = Date.now()
      const all = users.map((u) =>
        lib.leaveOrganization(deps({ lockLimits: limits }), event, u, org).catch((e: unknown) => e),
      )
      expect(await unrelatedQuery(2_000)).toBe('answered')
      const results = await Promise.all(all)
      expect(Date.now() - started).toBeLessThan(5_000)
      const codes = results.map(codeOf)
      expect(codes.filter((c) => c === 'ok').length).toBe(limits.maxConcurrent)
      expect(codes.filter((c) => c === 'org_write_busy').length).toBe(
        POOL + 1 - limits.maxConcurrent,
      )
    })

    it('pool size + 1 writes on DIFFERENT orgs: an unrelated query is answered, all settle', async () => {
      const orgs = Array.from({ length: POOL + 1 }, () => `burst-${randomUUID()}`)
      for (const o of orgs) await put(o, 'u-b', 'member')
      members = [{ id: 'm-b', userId: 'u-b', role: 'member' }]
      auth.mockImplementation(() => sleep(150).then(() => ({})))
      const all = orgs.map((o) =>
        lib
          .leaveOrganization(deps({ lockLimits: limits }), event, 'u-b', o)
          .catch((e: unknown) => e),
      )
      expect(await unrelatedQuery(2_000)).toBe('answered')
      const codes = (await Promise.all(all)).map(codeOf)
      expect(codes.filter((c) => c === 'ok').length).toBe(limits.maxConcurrent)
      expect(codes.every((c) => c === 'ok' || c === 'org_write_busy')).toBe(true)
      await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, orgs))
    })

    it('a write waiting on its org gets 503 org_write_busy within the bound', async () => {
      await put(org, 'u-hold', 'member')
      await put(org, 'u-wait', 'member')
      members = [
        { id: 'm-hold', userId: 'u-hold', role: 'member' },
        { id: 'm-wait', userId: 'u-wait', role: 'member' },
      ]
      let release!: () => void
      let held!: () => void
      const holding = new Promise<void>((r) => (held = r))
      auth.mockImplementationOnce(() => {
        held()
        return new Promise((r) => (release = () => r({})))
      })
      const first = lib.leaveOrganization(deps({ lockLimits: limits }), event, 'u-hold', org)
      await holding
      const started = Date.now()
      await expect(
        lib.leaveOrganization(
          deps({ lockLimits: { ...limits, waitMs: 300 } }),
          event,
          'u-wait',
          org,
        ),
      ).rejects.toMatchObject({ statusCode: 503, data: { code: 'org_write_busy' } })
      expect(Date.now() - started).toBeLessThan(1_500)
      release()
      await first
    })

    // A1 (Sikkerhed): pin "one connection per write". On a pool of ONE
    // connection, a write that took a second connection for any of its
    // transactions would wait for itself forever; this one must finish.
    it('a write completes on a pool of ONE connection (one connection per write)', async () => {
      const postgres = (await import('postgres')).default
      const { drizzle } = await import('drizzle-orm/postgres-js')
      const one = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
      const tiny = drizzle(one, { schema, casing: 'snake_case' }) as unknown as Db
      try {
        await put(org, 'u-one', 'member')
        members = [{ id: 'm-one', userId: 'u-one', role: 'member' }]
        auth.mockResolvedValue({})
        const done = await Promise.race([
          lib.removeMember(deps({ db: tiny }), event, 'owner', org, 'm-one').then(() => 'done'),
          sleep(3_000).then(() => 'hung'),
        ])
        expect(done).toBe('done')
        expect(await roleOf(org, 'u-one')).toBeNull()
      } finally {
        await one.end({ timeout: 1 })
      }
    })

    // A2 (Sikkerhed): if the unlock does not say true, the connection holding
    // the session lock must not go back to the pool still holding it.
    it('a failed unlock ends that backend, and the org is not left busy', async () => {
      await put(org, 'u-ul', 'member')
      await put(org, 'u-next', 'member')
      members = [
        { id: 'm-ul', userId: 'u-ul', role: 'member' },
        { id: 'm-next', userId: 'u-next', role: 'member' },
      ]
      vi.spyOn(console, 'error').mockImplementation(() => {})
      auth.mockResolvedValue({})
      // Drop the lock early on the locked connection, so the final unlock
      // finds nothing to release and answers false.
      const dropEarly = (locked: Db) =>
        new Proxy(locked, {
          get: (t, k) =>
            k === 'transaction'
              ? async (fn: never) => {
                  await locked.execute(sql`select pg_advisory_unlock_all()`)
                  return (t as Db).transaction(fn)
                }
              : Reflect.get(t, k),
        })
      let pid = 0
      const watchPid = (locked: Db) => {
        void locked
          .execute(sql`select pg_backend_pid() as pid`)
          .then((r) => (pid = Number((r as unknown as Array<{ pid: number }>)[0]?.pid)))
        return dropEarly(locked)
      }
      await lib.removeMember(deps({ onLocked: watchPid }), event, 'owner', org, 'm-ul')
      await sleep(200)
      const alive = await db.execute(
        sql`select count(*)::int as n from pg_stat_activity where pid = ${pid}`,
      )
      expect(pid).toBeGreaterThan(0)
      expect((alive as unknown as Array<{ n: number }>)[0]?.n).toBe(0)
      // The next write on the same org gets the lock at once.
      await expect(
        lib.removeMember(deps({ lockLimits: limits }), event, 'owner', org, 'm-next'),
      ).resolves.toEqual({})
    })

    it('leave by someone auth does not list as a member: 404 before any lock or auth call', async () => {
      members = []
      await expect(lib.leaveOrganization(deps(), event, 'stranger', org)).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(auth).not.toHaveBeenCalled()
    })
  })
})
