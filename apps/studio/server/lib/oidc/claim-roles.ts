import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db'
import { auditLog, orgMember, orgMemberClaim, organization } from '../../db/schema'
import { auditRow, type AuditEventInput } from '../audit'
import { ORG_RANK } from '../org-membership-input'
import type { ClaimRole, RoleMapping } from './config'

// Org roles granted from an IdP claim at login (OIDC_ROLE_CLAIM + OIDC_ROLE_MAP).
// OFF unless both are set. See docs/design/standalone-oidc.md.
//
// 🔴 THREE RULES
//   1. Studio wins. Only rows this code created (marked in org_member_claim)
//      are ever changed or withdrawn by it. A member assigned in Studio, by an
//      invitation, a role change or the bootstrap command, is never touched,
//      and any such change removes the marker, so the row becomes Studio's.
//   2. Never owner. The mapping cannot name owner (config refuses it), and a
//      row that is owner is never changed here.
//   3. The claim is re-read at every login: a value that is gone withdraws what
//      it granted at the next login. Between logins the grant stands; disable
//      the user in Studio to cut access at once.

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const rank = (r: string) => ORG_RANK.indexOf(r as ClaimRole)

/** org slug -> the highest role any of the values grants there. */
export function desiredRoles(mapping: RoleMapping, values: string[]): Map<string, ClaimRole> {
  const out = new Map<string, ClaimRole>()
  for (const v of new Set(values)) {
    for (const g of mapping.grants.get(v) ?? []) {
      const cur = out.get(g.orgSlug)
      if (!cur || rank(g.role) > rank(cur)) out.set(g.orgSlug, g.role)
    }
  }
  return out
}

export interface ClaimSyncResult {
  added: string[]
  changed: string[]
  removed: string[]
}

export async function syncClaimRoles(
  db: Db,
  mapping: RoleMapping,
  userId: string,
  values: string[],
): Promise<ClaimSyncResult> {
  const desired = desiredRoles(mapping, values)
  const result: ClaimSyncResult = { added: [], changed: [], removed: [] }
  await db.transaction(async (tx) => {
    const orgs = desired.size
      ? await tx
          .select({ id: organization.id, slug: organization.slug })
          .from(organization)
          .where(inArray(organization.slug, [...desired.keys()]))
      : []
    const wanted = new Map(orgs.map((o) => [o.id, desired.get(o.slug)!]))
    const marked = await tx
      .select({ organizationId: orgMemberClaim.organizationId })
      .from(orgMemberClaim)
      .where(eq(orgMemberClaim.userId, userId))
    const touched = [...new Set([...wanted.keys(), ...marked.map((m) => m.organizationId)])].sort()

    for (const orgId of touched) {
      // Same lock as every other change of who holds a role in this org.
      await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, orgId))
        .for('update')
      const [row] = await tx
        .select({ role: orgMember.role })
        .from(orgMember)
        .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, userId)))
      const [marker] = await tx
        .select({ userId: orgMemberClaim.userId })
        .from(orgMemberClaim)
        .where(and(eq(orgMemberClaim.organizationId, orgId), eq(orgMemberClaim.userId, userId)))
      const role = wanted.get(orgId)

      if (role && !row) {
        await tx.insert(orgMember).values({ organizationId: orgId, userId, role })
        await tx
          .insert(orgMemberClaim)
          .values({ organizationId: orgId, userId })
          .onConflictDoNothing()
        await audit(tx, orgId, userId, { action: 'member.added', after: { role } })
        result.added.push(orgId)
        continue
      }
      if (!row) {
        // A stale marker with no member row: nothing granted, just tidy it.
        if (marker) await dropMarker(tx, orgId, userId)
        continue
      }
      if (!marker || row.role === 'owner') continue
      if (role && role !== row.role) {
        await tx
          .update(orgMember)
          .set({ role })
          .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, userId)))
        await audit(tx, orgId, userId, {
          action: 'member.role_changed',
          before: { role: row.role },
          after: { role },
        })
        result.changed.push(orgId)
      } else if (!role) {
        await tx
          .delete(orgMember)
          .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, userId)))
        await dropMarker(tx, orgId, userId)
        await audit(tx, orgId, userId, { action: 'member.removed', before: { role: row.role } })
        result.removed.push(orgId)
      }
    }
  })
  return result
}

/** A change made in Studio makes the row Studio's: the claim stops managing it. */
export async function dropMarker(tx: Tx | Db, orgId: string, userId: string): Promise<void> {
  await tx
    .delete(orgMemberClaim)
    .where(and(eq(orgMemberClaim.organizationId, orgId), eq(orgMemberClaim.userId, userId)))
}

function audit(
  tx: Tx,
  orgId: string,
  userId: string,
  input: Pick<AuditEventInput, 'action' | 'before' | 'after'>,
) {
  return tx.insert(auditLog).values(
    auditRow(null, {
      ...input,
      organizationId: orgId,
      targetType: 'member',
      targetId: userId,
      actorEmail: 'idp-claim',
    }),
  )
}
