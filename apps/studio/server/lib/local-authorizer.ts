import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { orgMember, project, projectMachineGrant, projectMember } from '../db/schema'
import { isDevBypassSubject } from './dev-auth-bypass'
import type { Authorizer } from './authorizer'
import type { OrgRelation, PdpVerdict, ProjectAction } from './pdp'

// The LOCAL authorizer: the same questions pdp.ts asks the permissions service,
// answered from studio's own Postgres (AUTHORIZER=local).
//
// 🔴 THE RULES ARE THE PERMISSIONS MODEL'S, NOT NEW ONES. They are copied from
// KlangHaus/permissions model/klanghaus.fga (bddb430a, 2026-10-10), so the two
// authorizers give the same verdict for the same grants:
//
//   organization  owner, admin, manager, member, billing are SEPARATE direct
//                 relations: owner does not imply manager. checkOrg asks for
//                 one exact relation; project-access.ts ranks them.
//   can_admin     project admin, or org owner or manager
//   can_edit      project editor (user or machine), or can_admin
//   can_view      project viewer, or can_edit, or org admin or member
//                 org billing gets NO project access.
//
// Where the grants live:
//   org roles        org_member (new; nothing else in studio records them)
//   project roles    project_member (already written on invite accept)
//   machine roles    project_machine_grant (new; editor only)
//   project → org    project.organizationId, so linkProjectToOrg writes nothing
//
// Same three outcomes as pdp.ts: a database error is `unavailable`, never
// `allowed` and never `denied`, so an outage still reads as a 503.

const MACHINE_PREFIX = 'machine:'

function getActor(event: H3Event) {
  return event.context.auth ?? null
}

function unavailable(err: unknown, helper: string): 'unavailable' {
  console.error(`[authz:local] ${helper} could not be answered:`, (err as Error)?.message ?? err)
  return 'unavailable'
}

type ProjectGrants = {
  orgRole: string | null
  projectRole: string | null
}

/** The model's computed project relations, from one actor's direct grants. */
export function projectAllows(grants: ProjectGrants, action: ProjectAction): boolean {
  const { orgRole, projectRole } = grants
  const canAdmin = projectRole === 'admin' || orgRole === 'owner' || orgRole === 'manager'
  const canEdit = projectRole === 'editor' || canAdmin
  if (action === 'can_admin') return canAdmin
  if (action === 'can_edit') return canEdit
  return projectRole === 'viewer' || canEdit || orgRole === 'admin' || orgRole === 'member'
}

/** A machine principal is editor on the projects it was granted, nothing more. */
export function machineAllows(granted: boolean, action: ProjectAction): boolean {
  return granted && (action === 'can_edit' || action === 'can_view')
}

async function userGrants(
  userId: string,
  projectIds: string[],
): Promise<Map<string, ProjectGrants>> {
  const rows = await db
    .select({
      projectId: project.id,
      orgRole: orgMember.role,
      projectRole: projectMember.role,
    })
    .from(project)
    .leftJoin(
      orgMember,
      and(eq(orgMember.organizationId, project.organizationId), eq(orgMember.userId, userId)),
    )
    .leftJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)),
    )
    .where(inArray(project.id, projectIds))
  return new Map(rows.map((r) => [r.projectId, { orgRole: r.orgRole, projectRole: r.projectRole }]))
}

async function machineGrants(keyId: string, projectIds: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: projectMachineGrant.projectId })
    .from(projectMachineGrant)
    .where(
      and(
        eq(projectMachineGrant.apiKeyId, keyId),
        inArray(projectMachineGrant.projectId, projectIds),
      ),
    )
  return new Set(rows.map((r) => r.projectId))
}

async function decideProjects(
  sub: string,
  projectIds: string[],
  action: ProjectAction,
): Promise<Record<string, 'allowed' | 'denied'>> {
  const result: Record<string, 'allowed' | 'denied'> = {}
  if (sub.startsWith(MACHINE_PREFIX)) {
    const granted = await machineGrants(sub.slice(MACHINE_PREFIX.length), projectIds)
    for (const id of projectIds) {
      result[id] = machineAllows(granted.has(id), action) ? 'allowed' : 'denied'
    }
    return result
  }
  const grants = await userGrants(sub, projectIds)
  for (const id of projectIds) {
    // A project that does not exist has no grants: denied, as in the model.
    const g = grants.get(id) ?? { orgRole: null, projectRole: null }
    result[id] = projectAllows(g, action) ? 'allowed' : 'denied'
  }
  return result
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

export const localAuthorizer: Authorizer = {
  async checkProject(event, projectId, action) {
    const actor = getActor(event)
    if (!actor) return 'denied'
    if (isDevBypassSubject(event, actor.sub)) return 'allowed'
    // A malformed id would make Postgres throw on the uuid column, and that
    // would read as an outage. It names no project, so it grants nothing.
    if (!isUuid(projectId)) return 'denied'
    try {
      return (await decideProjects(actor.sub, [projectId], action))[projectId] ?? 'denied'
    } catch (err) {
      return unavailable(err, 'checkProject')
    }
  },

  async checkOrg(event, orgId, relation: OrgRelation): Promise<PdpVerdict> {
    const actor = getActor(event)
    if (!actor) return 'denied'
    if (isDevBypassSubject(event, actor.sub)) return 'allowed'
    // Org roles are user relations only; a machine key never holds one.
    if (actor.sub.startsWith(MACHINE_PREFIX)) return 'denied'
    try {
      const [row] = await db
        .select({ role: orgMember.role })
        .from(orgMember)
        .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, actor.sub)))
      return row?.role === relation ? 'allowed' : 'denied'
    } catch (err) {
      return unavailable(err, 'checkOrg')
    }
  },

  async batchCheckProjects(event, projectIds, action) {
    const actor = getActor(event)
    const result: Record<string, PdpVerdict> = {}
    for (const id of projectIds) result[id] = 'denied'
    if (!actor || projectIds.length === 0) return result
    if (isDevBypassSubject(event, actor.sub)) {
      for (const id of projectIds) result[id] = 'allowed'
      return result
    }
    const valid = projectIds.filter(isUuid)
    if (valid.length === 0) return result
    try {
      return { ...result, ...(await decideProjects(actor.sub, valid, action)) }
    } catch (err) {
      // Same as pdp.ts: one failure marks the whole batch, never `allowed`.
      const outcome = unavailable(err, 'batchCheckProjects')
      for (const id of projectIds) result[id] = outcome
      return result
    }
  },

  // ─── writes: throw on failure, like pdp.ts, so callers roll back ─────────

  async grantProjectRole(_event, projectId, subject, role) {
    // The invite-accept endpoint writes the same row with the member's email
    // right after this; it upserts, so the two writes agree.
    await db
      .insert(projectMember)
      .values({ projectId, userId: subject, role })
      .onConflictDoUpdate({
        target: [projectMember.projectId, projectMember.userId],
        set: { role },
      })
  },

  async revokeProjectRole(_event, projectId, subject, role) {
    await db
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.projectId, projectId),
          eq(projectMember.userId, subject),
          eq(projectMember.role, role),
        ),
      )
  },

  async grantMachineProjectRole(_event, projectId, keyId, role) {
    // The table refuses anything but editor (check constraint), the same
    // least-privilege line the permissions model draws.
    await db
      .insert(projectMachineGrant)
      .values({ projectId, apiKeyId: keyId, role })
      .onConflictDoNothing()
  },

  async revokeMachineProjectRole(_event, projectId, keyId, role) {
    await db
      .delete(projectMachineGrant)
      .where(
        and(
          eq(projectMachineGrant.projectId, projectId),
          eq(projectMachineGrant.apiKeyId, keyId),
          eq(projectMachineGrant.role, role),
        ),
      )
  },

  async linkProjectToOrg() {
    // project.organizationId already is the link; there is nothing to write.
  },
}
