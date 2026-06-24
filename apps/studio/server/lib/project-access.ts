import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { project } from '../db/schema'
import { lookupOrgById } from './org-lookup'
import { checkOrg, checkProject } from './pdp'

// Two-layer permissions, Sentry-style — now adjudicated by the central
// Permissions PDP (Beslutning O). The PDP's OpenFGA model implements the same
// semantics that used to live here:
//
//   organization roles: owner > manager > admin > member > billing
//   project relations:  viewer < editor < admin, plus computed
//                        can_view / can_edit / can_admin = max(orgRole, projectRole)
//
// This module keeps its EXPORTED SIGNATURES stable so the ~14 endpoint
// call-sites don't change: requireProjectAccess / requireOrgRole / getProjectRole
// still return ProjectAccess / OrgAccess, but the decision now comes from
// pdp.ts (Check) and identity from event.context.auth instead of the member /
// project_member tables.

export type ProjectRole = 'viewer' | 'editor' | 'admin'
export const PROJECT_ROLES = ['viewer', 'editor', 'admin'] as const

export type OrgRole = 'billing' | 'member' | 'admin' | 'manager' | 'owner'
export const ORG_ROLES = ['billing', 'member', 'admin', 'manager', 'owner'] as const

// PDP project relation per minimum role. The PDP maps action→relation and
// applies the role hierarchy, so a single Check at the required level answers
// "does the actor meet this bar?".
const PROJECT_ACTION: Record<ProjectRole, 'can_view' | 'can_edit' | 'can_admin'> = {
  viewer: 'can_view',
  editor: 'can_edit',
  admin: 'can_admin',
}

// Lightweight org shape. We no longer own the organization table — id is the
// tenant/org id carried on project.organizationId; name/slug are resolved
// best-effort from the central auth service for display.
export interface OrgRef {
  id: string
  name: string
  slug: string
}

export interface ProjectAccess {
  userId: string
  project: typeof project.$inferSelect
  organization: OrgRef
  // Effective role, resolved by probing the PDP from the top down.
  role: ProjectRole
}

/**
 * Resolve the effective project role for the current actor by probing the PDP
 * from the highest relation down. Returns null if the actor has no access.
 *
 * Kept as a named export for parity with the old helper; endpoints should
 * prefer requireProjectAccess. The first two positional args mirror the old
 * (userId, projectId) call for the test surface, but the decision is the
 * PDP's — userId must equal the JWT sub (the PDP scopes by the bearer token).
 */
export async function resolveProjectRole(
  event: H3Event,
  projectId: string,
): Promise<ProjectRole | null> {
  if (await checkProject(event, projectId, 'can_admin')) return 'admin'
  if (await checkProject(event, projectId, 'can_edit')) return 'editor'
  if (await checkProject(event, projectId, 'can_view')) return 'viewer'
  return null
}

/**
 * Verify the current request has access to a project at minimum `min` role.
 * Returns project + effective role + a lightweight org ref. Throws 401/403/404.
 */
export async function requireProjectAccess(
  event: H3Event,
  projectId: string,
  min: ProjectRole = 'viewer',
): Promise<ProjectAccess> {
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const [proj] = await db.select().from(project).where(eq(project.id, projectId))
  if (!proj) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  // One Check at the required bar — the PDP applies the role hierarchy.
  const allowed = await checkProject(event, projectId, PROJECT_ACTION[min])
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: `Requires project:${min}` })
  }

  // Resolve the precise role for callers that branch on it (and to keep the
  // ProjectAccess shape meaningful). This costs at most two extra Checks above
  // `min`; admin endpoints (the common write path) already pass min='admin'.
  const role = (await resolveProjectRole(event, projectId)) ?? min

  const org = await lookupOrgById(event, proj.organizationId)

  return {
    userId: actor.sub,
    project: proj,
    organization: org ?? { id: proj.organizationId, name: '', slug: '' },
    role,
  }
}

export interface OrgAccess {
  userId: string
  organizationId: string
  role: OrgRole
}

/**
 * Verify the current request has membership in the given org at minimum `min`
 * role. The PDP adjudicates; `role` in the result is the lowest relation that
 * passed (the precise role isn't needed by callers beyond the gate, but we
 * resolve it top-down for completeness).
 */
export async function requireOrgRole(
  event: H3Event,
  organizationId: string,
  min: OrgRole = 'member',
): Promise<OrgAccess> {
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const allowed = await checkOrg(event, organizationId, min)
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: `Requires org:${min}` })
  }

  const role = (await resolveOrgRole(event, organizationId)) ?? min
  return { userId: actor.sub, organizationId, role }
}

async function resolveOrgRole(event: H3Event, orgId: string): Promise<OrgRole | null> {
  // Probe from the top so the highest-held role wins, matching ORG_ROLE_RANK.
  for (const role of ['owner', 'manager', 'admin', 'member', 'billing'] as const) {
    if (await checkOrg(event, orgId, role)) return role
  }
  return null
}

export const orgRoleHelpers = {
  canManageOrgMembers: (role: OrgRole) => role === 'owner' || role === 'manager',
  canManageBilling: (role: OrgRole) => role === 'owner' || role === 'billing',
  canCreateProjects: (role: OrgRole) => role === 'owner' || role === 'manager' || role === 'admin',
  canViewProjects: (role: OrgRole) => role !== 'billing',
}
