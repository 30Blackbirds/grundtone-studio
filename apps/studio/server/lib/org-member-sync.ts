import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db'
import { orgMember } from '../db/schema'
import { withOrgLockOn } from './org-membership'
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

/** One org as auth sees it. `role` is auth's raw string (it may list several). */
export interface AuthOrg {
  orgId: string
  members: Array<{ userId: string; role: string }>
}

/**
 * Auth's orgs and members. `complete` must be true only when every org was
 * listed; an org missing from an incomplete listing proves nothing.
 */
export interface MemberSource {
  listOrgs(): Promise<{ orgs: AuthOrg[]; complete: boolean }>
  /** One org again, for the second read; null when auth has no such org. */
  readOrg(orgId: string): Promise<AuthOrg | null>
}

/**
 * The single role studio records for auth's raw role: the highest known role
 * by ORG_ROLES rank. Unknown parts are ignored; nothing known means null.
 */
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
    const held = heldRole(raw)
    if (held !== r.role) {
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
  /** False when auth's listing was incomplete: orgs it did not list were not judged. */
  complete: boolean
  orgsCompared: number
  differences: Difference[]
  /** Rows deleted (only when repairing): stale rows, and rows whose studio role exceeds auth's. */
  deleted: Array<{ orgId: string; userId: string; studioRole: string }>
}

/**
 * True when studio's role holds a right auth's role does not, judged by rank.
 * Equal or lower rank never exceeds; a role studio cannot rank always does.
 */
function exceeds(studioRole: string, authRaw: string): boolean {
  const held = heldRole(authRaw)
  if (!held) return true
  const s = ORG_ROLES.indexOf(studioRole as OrgRole)
  if (s < 0) return true
  // billing sits lowest by rank but holds a right (billing) no other role
  // below owner has: billing next to anything but billing or owner exceeds.
  if (studioRole === 'billing') return held !== 'billing' && held !== 'owner'
  return s > ORG_ROLES.indexOf(held)
}

/**
 * Compares every org auth lists, and every org studio has rows for. With
 * `repair`, deletes what makes studio hold MORE than auth: a stale row, or a
 * row whose role exceeds auth's. Nothing is inserted or raised; `missing` and
 * a lower studio role are reported and left. An org studio has rows for but
 * auth did not list is judged only when auth's listing was complete. Each
 * org's repair runs under that org's lock, on one reserved connection with a
 * bounded wait (withOrgLockOn), so it cannot interleave with a route's write
 * or take more than one connection; it re-reads auth before deleting. A busy
 * org ends the run with 503 org_write_busy; a re-run continues.
 */
export async function compareOrgMembers(
  db: Db,
  source: MemberSource,
  opts: { repair: boolean },
): Promise<CompareReport> {
  const { orgs, complete } = await source.listOrgs()
  const listed = new Map(orgs.map((o) => [o.orgId, o]))
  const unlisted = (await studioOrgIds(db)).filter((id) => !listed.has(id))
  const judged: Array<[string, AuthOrg | null]> = [
    ...orgs.map((o) => [o.orgId, o] as [string, AuthOrg]),
    ...(complete ? unlisted.map((id) => [id, null] as [string, null]) : []),
  ]

  const report: CompareReport = { complete, orgsCompared: 0, differences: [], deleted: [] }
  for (const [orgId, first] of judged) {
    report.orgsCompared++
    if (!opts.repair) {
      report.differences.push(...diffOrg(orgId, await studioRows(db, orgId), first))
      continue
    }
    // Under the org's lock, on its one reserved connection (`db` below is it).
    await withOrgLockOn(db, orgId, async (db) => {
      // Under the lock: studio's rows and auth's members as they are NOW, so a
      // change a route made since the listing is not undone.
      const auth = await source.readOrg(orgId)
      const diffs = diffOrg(orgId, await studioRows(db, orgId), auth)
      report.differences.push(...diffs)
      const doomed = diffs.filter(
        (d): d is Extract<Difference, { kind: 'stale' | 'role_differs' }> =>
          d.kind === 'stale' || (d.kind === 'role_differs' && exceeds(d.studioRole, d.authRole)),
      )
      if (!doomed.length) return
      await db.delete(orgMember).where(
        and(
          eq(orgMember.organizationId, orgId),
          inArray(
            orgMember.userId,
            doomed.map((d) => d.userId),
          ),
        ),
      )
      report.deleted.push(
        ...doomed.map((d) => ({ orgId, userId: d.userId, studioRole: d.studioRole })),
      )
    })
  }
  return report
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
  const { orgs, complete } = await source.listOrgs()
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
  }
  for (const org of orgs) {
    c.membersRead += org.members.length
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
      const landed = await db
        .insert(orgMember)
        .values(toInsert.map((r) => ({ organizationId: org.orgId, ...r })))
        .onConflictDoNothing()
        .returning({ userId: orgMember.userId, role: orgMember.role })

      const again = await source.readOrg(org.orgId)
      const confirmed = new Map(
        (again?.members ?? []).map((m) => [m.userId, heldRole(m.role)] as const),
      )
      const unconfirmed = landed.filter((r) => confirmed.get(r.userId) !== r.role)
      if (unconfirmed.length) {
        await db.delete(orgMember).where(
          and(
            eq(orgMember.organizationId, org.orgId),
            inArray(
              orgMember.userId,
              unconfirmed.map((r) => r.userId),
            ),
          ),
        )
      }
      c.inserted += landed.length - unconfirmed.length
      c.removedAfterReread += unconfirmed.length
    })
  }
  return c
}
