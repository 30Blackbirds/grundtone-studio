import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db'
import { auditLog, orgMember } from '../db/schema'
import { auditRow, type AuditAction } from './audit'
import { onlyAdds, withOrgLockOn } from './org-membership'
import { ORG_ROLES, type OrgRole } from './project-access'

// Comparing auth's org members with studio's org_member, and the two things
// done with the difference:
//
//   compare + repair (PR-E)  report every difference; change only what makes
//                            studio hold LESS: delete a row auth does not
//                            confirm. Never insert, never raise a role.
//   backfill (D-E1)          the one-time load: insert the role a member
//                            actually holds in auth where studio has no row.
//                            It grants, so it runs only on Allan's word.
//
// Both read auth through an injected MemberSource. How studio reads every
// org's members server-side is not decided (no user session exists here), so
// no source for auth is built in this file.

/**
 * One org as auth sees it. `role` is auth's raw string (it may list several).
 *
 * 🔴 THE SAME RULE ONE LEVEL DOWN (Sikkerhed C1 on #391): a member missing from
 * an org's list is deleted as stale by a repair, so a list that is merely
 * truncated deletes CURRENT members. A real source sets `membersComplete` only
 * when its paging says the org's last page was read, and `memberCount` from an
 * independent count. An org without both, or with a count that does not match
 * the list, is compared and REPORTED, never repaired.
 */
export interface AuthOrg {
  orgId: string
  members: Array<{ userId: string; role: string }>
  membersComplete?: boolean
  memberCount?: number
}

/** True when an org's member list is proven complete (signal and matching count). */
export function membersProven(org: AuthOrg): boolean {
  return (
    org.membersComplete === true &&
    typeof org.memberCount === 'number' &&
    org.memberCount === org.members.length
  )
}

/**
 * Auth's listing of orgs.
 *
 * 🔴 A WRONG "complete" IS A MASS LOSS OF ACCESS: every org it leaves out has
 * all its rows deleted by a repair. So a real source sets `complete` only
 * when its own paging says the last page was read, AND it reports
 * `expectedCount` from an independent count (a separate count query or
 * endpoint, not the length of what it read). compareOrgMembers treats the
 * listing as complete only when both hold and the count matches what was
 * read; anything else (a missing signal, a missing count, a mismatch) is
 * incomplete, and unlisted orgs are then not judged.
 */
export interface OrgListing {
  orgs: AuthOrg[]
  complete: boolean
  expectedCount?: number
}

export interface MemberSource {
  listOrgs(): Promise<OrgListing>
  /** One org again, for the second read; null when auth has no such org. */
  readOrg(orgId: string): Promise<AuthOrg | null>
}

/**
 * The single role studio records for auth's raw role: the highest known role
 * by ORG_ROLES rank. Unknown parts are ignored; nothing known means null.
 */
/** Every role in auth's raw string that studio knows. */
export function authRoles(raw: string): OrgRole[] {
  return raw
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is OrgRole => (ORG_ROLES as readonly string[]).includes(r))
}

export function heldRole(raw: string): OrgRole | null {
  const known = raw
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is OrgRole => (ORG_ROLES as readonly string[]).includes(r))
  if (!known.length) return null
  return known.reduce((a, b) => (ORG_ROLES.indexOf(b) > ORG_ROLES.indexOf(a) ? b : a))
}

export type Difference =
  /** studio has a row; auth has no such member (or no such org). */
  | { kind: 'stale'; orgId: string; userId: string; studioRole: string }
  /** both have the member, with different roles. */
  | { kind: 'role_differs'; orgId: string; userId: string; studioRole: string; authRole: string }
  /** auth has the member; studio has no row. */
  | { kind: 'missing'; orgId: string; userId: string; authRole: string }
  /** auth's role has no part studio knows. */
  | { kind: 'unknown_role'; orgId: string; userId: string; authRole: string }

type Row = { userId: string; role: string }

function diffOrg(orgId: string, studio: Row[], auth: AuthOrg | null): Difference[] {
  const out: Difference[] = []
  const authBy = new Map((auth?.members ?? []).map((m) => [m.userId, m.role]))
  const studioBy = new Map(studio.map((r) => [r.userId, r.role]))
  for (const r of studio) {
    const raw = authBy.get(r.userId)
    if (raw === undefined) {
      out.push({ kind: 'stale', orgId, userId: r.userId, studioRole: r.role })
      continue
    }
    // Studio records one role; it agrees with auth when that role is one of
    // the roles auth holds (Sikkerhed A1 on #391: compare against the SET).
    if (!authRoles(raw).includes(r.role as OrgRole)) {
      out.push({ kind: 'role_differs', orgId, userId: r.userId, studioRole: r.role, authRole: raw })
    }
  }
  for (const [userId, raw] of authBy) {
    if (studioBy.has(userId)) continue
    out.push(
      heldRole(raw)
        ? { kind: 'missing', orgId, userId, authRole: raw }
        : { kind: 'unknown_role', orgId, userId, authRole: raw },
    )
  }
  return out
}

async function studioRows(db: Db, orgId: string): Promise<Row[]> {
  return db
    .select({ userId: orgMember.userId, role: orgMember.role })
    .from(orgMember)
    .where(eq(orgMember.organizationId, orgId))
}

async function studioOrgIds(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ orgId: orgMember.organizationId }).from(orgMember)
  return rows.map((r) => r.orgId)
}

export interface CompareReport {
  /** False when auth's listing was not proven complete: orgs it did not list were not judged. */
  complete: boolean
  /** Set when the planned deletions exceeded `maxDeletions`: nothing was deleted. */
  refused?: { planned: number; maxDeletions: number }
  orgsCompared: number
  differences: Difference[]
  /** Rows deleted (only when repairing): stale rows, and rows whose studio role exceeds auth's. */
  deleted: Array<{ orgId: string; userId: string; studioRole: string }>
  /** Orgs whose member list was not proven complete: reported, never repaired. */
  unproven: string[]
  /** Orgs busy with another write when the repair reached them: reported, not repaired. */
  busy: string[]
}

async function auditSync(
  db: Db,
  orgId: string,
  action: AuditAction,
  rows: Array<{ userId: string; role: string }>,
  why: string,
) {
  if (!rows.length) return
  await db.insert(auditLog).values(
    rows.map((r) =>
      auditRow(null, {
        organizationId: orgId,
        action,
        targetType: 'member',
        targetId: r.userId,
        before: action === 'member.sync_removed' ? { role: r.role } : undefined,
        after: action === 'member.backfilled' ? { role: r.role } : { reason: why },
      }),
    ),
  )
}

/**
 * True when studio's role holds a right that none of auth's roles holds,
 * judged by the same rights the routes use (onlyAdds). A role studio cannot
 * place always exceeds, and so does an auth role set studio knows nothing of.
 */
function exceeds(studioRole: string, authRaw: string): boolean {
  if (!(ORG_ROLES as readonly string[]).includes(studioRole)) return true
  return !authRoles(authRaw).some((r) => onlyAdds(studioRole as OrgRole, r))
}

/**
 * Compares every org auth lists, and every org studio has rows for. With
 * `repair`, deletes what makes studio hold MORE than auth: a stale row, or a
 * row whose role exceeds auth's. Nothing is inserted or raised; `missing` and
 * a lower studio role are reported and left. An org studio has rows for but
 * auth did not list is judged only when auth's listing was complete. Each
 * org's repair runs under that org's lock, on one reserved connection with a
 * bounded wait (withOrgLockOn), so it cannot interleave with a route's write
 * or take more than one connection; it re-reads auth before deleting. An org
 * whose member list is not proven complete is reported, never repaired, and a
 * busy org is named in the report and left for a later run. Every deletion
 * writes an audit row in the same transaction.
 */
/** Which orgs a run covers. There is no default: a caller must say 'all'. */
export type OrgScope = 'all' | ((orgId: string) => boolean)

export async function compareOrgMembers(
  db: Db,
  source: MemberSource,
  opts:
    | { repair: false; scope: OrgScope }
    | {
        repair: true
        scope: OrgScope
        /**
         * The most rows one run may delete. Above it the run deletes NOTHING
         * and reports `refused`; a person looks before anything is removed.
         */
        maxDeletions: number
      },
): Promise<CompareReport> {
  const inScope = opts.scope === 'all' ? () => true : opts.scope
  const listing = await source.listOrgs()
  const orgs = listing.orgs.filter((o) => inScope(o.orgId))
  // Complete only with the source's own signal AND a matching independent count.
  const complete =
    listing.complete === true &&
    typeof listing.expectedCount === 'number' &&
    listing.expectedCount === listing.orgs.length
  const listed = new Map(orgs.map((o) => [o.orgId, o]))
  const unlisted = (await studioOrgIds(db)).filter((id) => inScope(id) && !listed.has(id))
  const judged: Array<[string, AuthOrg | null]> = [
    ...orgs.map((o) => [o.orgId, o] as [string, AuthOrg]),
    ...(complete ? unlisted.map((id) => [id, null] as [string, null]) : []),
  ]

  const report: CompareReport = {
    complete,
    orgsCompared: 0,
    differences: [],
    deleted: [],
    unproven: [],
    busy: [],
  }
  // An unlisted org under a proven-complete listing has, provably, no members.
  // A listed org's absences count only when its own list is proven.
  const repairable = (auth: AuthOrg | null) => auth === null || membersProven(auth)
  const doomedOf = (diffs: Difference[]) =>
    diffs.filter(
      (d): d is Extract<Difference, { kind: 'stale' | 'role_differs' }> =>
        d.kind === 'stale' || (d.kind === 'role_differs' && exceeds(d.studioRole, d.authRole)),
    )

  // First pass, no lock, no writes: what the run would compare and delete.
  const planned: Difference[] = []
  const plannedDoomed: Difference[] = []
  for (const [orgId, first] of judged) {
    const diffs = diffOrg(orgId, await studioRows(db, orgId), first)
    planned.push(...diffs)
    if (repairable(first)) plannedDoomed.push(...doomedOf(diffs))
    else report.unproven.push(orgId)
  }
  report.orgsCompared = judged.length
  if (!opts.repair) {
    report.differences = planned
    return report
  }
  const maxDeletions = opts.maxDeletions
  const plannedDeletions = plannedDoomed.length
  if (plannedDeletions > maxDeletions) {
    report.differences = planned
    report.refused = { planned: plannedDeletions, maxDeletions }
    return report
  }

  // Second pass: each org under its lock, against auth as it is NOW. The cap
  // still holds if auth changed since the first pass.
  for (const [orgId, first] of judged) {
    if (!repairable(first)) {
      report.differences.push(...planned.filter((d) => d.orgId === orgId))
      continue
    }
    try {
      await repairOrg(orgId, first === null)
    } catch (err) {
      // A busy org must not end the run and lose the report: it is named, and
      // a later run repairs it.
      if ((err as { data?: { code?: string } })?.data?.code !== 'org_write_busy') throw err
      report.busy.push(orgId)
      report.differences.push(...planned.filter((d) => d.orgId === orgId))
    }
  }
  return report

  async function repairOrg(orgId: string, unlisted: boolean) {
    await withOrgLockOn(db, orgId, async (db) => {
      const auth = await source.readOrg(orgId)
      const diffs = diffOrg(orgId, await studioRows(db, orgId), auth)
      report.differences.push(...diffs)
      // Under the lock the org must still be provably what the plan judged:
      // absent (for an unlisted org) or listed with a proven member list.
      if (unlisted ? auth !== null : !auth || !membersProven(auth)) {
        report.unproven.push(orgId)
        return
      }
      const doomed = doomedOf(diffs)
      if (!doomed.length) return
      if (report.deleted.length + doomed.length > maxDeletions) {
        report.refused = {
          planned: report.deleted.length + doomed.length,
          maxDeletions,
        }
        return
      }
      await db.transaction(async (tx) => {
        const gone = await (tx as unknown as Db)
          .delete(orgMember)
          .where(
            and(
              eq(orgMember.organizationId, orgId),
              inArray(
                orgMember.userId,
                doomed.map((d) => d.userId),
              ),
            ),
          )
          .returning({ userId: orgMember.userId, role: orgMember.role })
        await auditSync(
          tx as unknown as Db,
          orgId,
          'member.sync_removed',
          gone,
          'not confirmed by auth',
        )
      })
      report.deleted.push(
        ...doomed.map((d) => ({ orgId, userId: d.userId, studioRole: d.studioRole })),
      )
    })
  }
}

export interface BackfillCounts {
  dryRun: boolean
  complete: boolean
  orgs: number
  membersRead: number
  /** Rows the run would insert (dry run) or inserted and auth confirmed again. */
  inserted: number
  /** Members studio already had a row for: never overwritten. */
  existing: number
  /** Members whose auth role has no part studio knows. */
  skippedUnknownRole: number
  /** Members whose auth role lists several known roles; the highest was taken. */
  multipleRoles: number
  /** Inserted rows the second read of auth did not confirm, and removed again. */
  removedAfterReread: number
  /** Orgs busy with another write: skipped, for a later run. */
  busyOrgs: string[]
}

/**
 * 🔴 D-E1, THE ONE-TIME LOAD. It GRANTS, so a real run needs Allan's word; the
 * default is a dry run that writes nothing and only counts.
 *
 * For each org: insert the held role (heldRole) for every auth member studio
 * has no row for; never overwrite an existing row (a route's row is newer).
 * Then read auth for that org AGAIN and remove every row this run inserted
 * that the second read does not confirm with the same role, so a member
 * removed between the two reads is not brought back. All of it under that
 * org's lock.
 */
export async function backfillOrgMembers(
  db: Db,
  source: MemberSource,
  opts: { dryRun: boolean },
): Promise<BackfillCounts> {
  const listing = await source.listOrgs()
  const orgs = listing.orgs
  const complete =
    listing.complete === true &&
    typeof listing.expectedCount === 'number' &&
    listing.expectedCount === listing.orgs.length
  const c: BackfillCounts = {
    dryRun: opts.dryRun,
    complete,
    orgs: orgs.length,
    membersRead: 0,
    inserted: 0,
    existing: 0,
    skippedUnknownRole: 0,
    multipleRoles: 0,
    removedAfterReread: 0,
    busyOrgs: [],
  }
  for (const org of orgs) {
    c.membersRead += org.members.length
    try {
      await loadOrg(org)
    } catch (err) {
      if ((err as { data?: { code?: string } })?.data?.code !== 'org_write_busy') throw err
      c.busyOrgs.push(org.orgId)
    }
  }
  return c

  async function loadOrg(org: AuthOrg) {
    await withOrgLockOn(db, org.orgId, async (db) => {
      const have = new Set((await studioRows(db, org.orgId)).map((r) => r.userId))
      const toInsert: Array<{ userId: string; role: OrgRole }> = []
      for (const m of org.members) {
        if (have.has(m.userId)) {
          c.existing++
          continue
        }
        const role = heldRole(m.role)
        if (!role) {
          c.skippedUnknownRole++
          continue
        }
        if (m.role.split(',').filter((r) => heldRole(r)).length > 1) c.multipleRoles++
        toInsert.push({ userId: m.userId, role })
      }
      if (opts.dryRun) {
        c.inserted += toInsert.length
        return
      }
      if (!toInsert.length) return
      const landed = await db.transaction(async (tx) => {
        const rows = await (tx as unknown as Db)
          .insert(orgMember)
          .values(toInsert.map((r) => ({ organizationId: org.orgId, ...r })))
          .onConflictDoNothing()
          .returning({ userId: orgMember.userId, role: orgMember.role })
        await auditSync(tx as unknown as Db, org.orgId, 'member.backfilled', rows, 'backfill')
        return rows
      })

      const again = await source.readOrg(org.orgId)
      const confirmed = new Map(
        (again?.members ?? []).map((m) => [m.userId, heldRole(m.role)] as const),
      )
      const unconfirmed = landed.filter((r) => confirmed.get(r.userId) !== r.role)
      if (unconfirmed.length) {
        await db.transaction(async (tx) => {
          await (tx as unknown as Db).delete(orgMember).where(
            and(
              eq(orgMember.organizationId, org.orgId),
              inArray(
                orgMember.userId,
                unconfirmed.map((r) => r.userId),
              ),
            ),
          )
          await auditSync(
            tx as unknown as Db,
            org.orgId,
            'member.sync_removed',
            unconfirmed,
            'backfill: not confirmed by a second read',
          )
        })
      }
      c.inserted += landed.length - unconfirmed.length
      c.removedAfterReread += unconfirmed.length
    })
  }
}
