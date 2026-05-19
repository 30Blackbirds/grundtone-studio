import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { project, projectMember } from '../db/schema'
import { member, organization } from '../db/schema/auth'
import { auth } from './auth'

// Two-layer permissions, Sentry-style.
//
// Org-role is one of:
//   billing  — manage subscription only; no project access
//   member   — read-only across the org; project access only via direct invite
//   admin    — same as member, but can create new projects (becomes admin of
//              those) and gets admin on projects they're invited to
//   manager  — admin on every project + can add/remove org members
//   owner    — unrestricted; the user who creates the org gets this role
//
// Project-role is one of: viewer, editor, admin.
//
// Effective project role = max(org-role-mapped, direct-project-role). Mapping:
//   owner | manager  → admin   (full power on every project)
//   admin  | member  → viewer  (read-only on every project by default)
//   billing          → null    (no project access at all)
//
// "admin" at the org level gets elevated to project admin only when they're
// invited to a specific project as admin. Same for write access at "member".

export type ProjectRole = 'viewer' | 'editor' | 'admin'
export const PROJECT_ROLES = ['viewer', 'editor', 'admin'] as const
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, admin: 2 }

export type OrgRole = 'billing' | 'member' | 'admin' | 'manager' | 'owner'
export const ORG_ROLES = ['billing', 'member', 'admin', 'manager', 'owner'] as const
const ORG_ROLE_RANK: Record<OrgRole, number> = {
  billing: 0,
  member: 1,
  admin: 2,
  manager: 3,
  owner: 4,
}

function isOrgRole(value: string): value is OrgRole {
  return (
    value === 'billing' ||
    value === 'member' ||
    value === 'admin' ||
    value === 'manager' ||
    value === 'owner'
  )
}

function projectRoleFromOrgRole(orgRole: OrgRole): ProjectRole | null {
  if (orgRole === 'owner' || orgRole === 'manager') return 'admin'
  if (orgRole === 'admin' || orgRole === 'member') return 'viewer'
  return null
}

function isProjectRole(value: string): value is ProjectRole {
  return value === 'viewer' || value === 'editor' || value === 'admin'
}

function maxRole(a: ProjectRole | null, b: ProjectRole | null): ProjectRole | null {
  if (!a) return b
  if (!b) return a
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b
}

export interface ProjectAccess {
  userId: string
  project: typeof project.$inferSelect
  organization: typeof organization.$inferSelect
  role: ProjectRole
  source: 'org' | 'project' | 'both'
  orgRole: OrgRole | null
  projectRole: ProjectRole | null
}

/**
 * Resolve the effective project role for a user, combining org membership
 * and direct project membership. Returns null if the user has no access.
 *
 * Pass `knownOrganizationId` when you've already fetched the project row to
 * skip the inner project lookup — requireProjectAccess does this on every
 * request, so the optimization matters at scale.
 */
export async function getProjectRole(
  userId: string,
  projectId: string,
  knownOrganizationId?: string,
): Promise<Pick<ProjectAccess, 'role' | 'source' | 'orgRole' | 'projectRole'> | null> {
  let organizationId = knownOrganizationId
  if (!organizationId) {
    const [proj] = await db
      .select({ organizationId: project.organizationId })
      .from(project)
      .where(eq(project.id, projectId))
    if (!proj) return null
    organizationId = proj.organizationId
  }

  const [orgMember] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
  const orgRole: OrgRole | null = orgMember && isOrgRole(orgMember.role) ? orgMember.role : null

  const [projMember] = await db
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)))
  const projectRole: ProjectRole | null =
    projMember && isProjectRole(projMember.role) ? projMember.role : null

  const fromOrg = orgRole ? projectRoleFromOrgRole(orgRole) : null
  const role = maxRole(fromOrg, projectRole)
  if (!role) return null

  const source: 'org' | 'project' | 'both' =
    fromOrg && projectRole ? 'both' : fromOrg ? 'org' : 'project'

  return { role, source, orgRole, projectRole }
}

/**
 * Verify the current session has access to a project at minimum `min` role.
 * Returns project + effective role + source. Throws 401/403/404 otherwise.
 */
export async function requireProjectAccess(
  event: H3Event,
  projectId: string,
  min: ProjectRole = 'viewer',
): Promise<ProjectAccess> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const [proj] = await db.select().from(project).where(eq(project.id, projectId))
  if (!proj) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const [orgRow] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, proj.organizationId))
  if (!orgRow) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  const resolved = await getProjectRole(session.user.id, projectId, proj.organizationId)
  if (!resolved) {
    throw createError({ statusCode: 403, statusMessage: 'No access to this project' })
  }

  if (ROLE_RANK[resolved.role] < ROLE_RANK[min]) {
    throw createError({ statusCode: 403, statusMessage: `Requires project:${min}` })
  }

  return {
    userId: session.user.id,
    project: proj,
    organization: orgRow,
    ...resolved,
  }
}

export interface OrgAccess {
  userId: string
  organizationId: string
  role: OrgRole
}

/**
 * Verify the current session has membership in the given org at minimum
 * `min` role. Use for org-level endpoints (member management, billing,
 * org-wide settings). Project endpoints should use `requireProjectAccess`.
 */
export async function requireOrgRole(
  event: H3Event,
  organizationId: string,
  min: OrgRole = 'member',
): Promise<OrgAccess> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const [orgMember] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))

  if (!orgMember || !isOrgRole(orgMember.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Not a member of this organization' })
  }

  if (ORG_ROLE_RANK[orgMember.role] < ORG_ROLE_RANK[min]) {
    throw createError({ statusCode: 403, statusMessage: `Requires org:${min}` })
  }

  return { userId: session.user.id, organizationId, role: orgMember.role }
}

export const orgRoleHelpers = {
  canManageOrgMembers: (role: OrgRole) => role === 'owner' || role === 'manager',
  canManageBilling: (role: OrgRole) => role === 'owner' || role === 'billing',
  canCreateProjects: (role: OrgRole) => role === 'owner' || role === 'manager' || role === 'admin',
  canViewProjects: (role: OrgRole) => role !== 'billing',
}
