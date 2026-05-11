import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { project, projectMember } from '../db/schema'
import { member, organization } from '../db/schema/auth'
import { auth } from './auth'

// Two-layer permissions. A user can be reached by EITHER:
//   - membership in the project's organization (org-role)
//   - direct membership of the project (project-role)
// The effective role is whichever is broader (org wins ties). Org owners
// always get full power on every project in their org regardless of any
// project-role override.
//
// Project-role uses three tiers; org-role still uses Better Auth's
// owner/admin/member triple. Mapping:
//   owner   ─┐
//   admin   ─┼─→ admin     (full editor + member management)
//   member  ───→ editor    (can edit tokens + publish + API keys)
//                viewer    (read-only — no API keys, no edits)

export type ProjectRole = 'viewer' | 'editor' | 'admin'
export const PROJECT_ROLES = ['viewer', 'editor', 'admin'] as const
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, admin: 2 }

export type OrgRole = 'owner' | 'admin' | 'member'

function projectRoleFromOrgRole(orgRole: string): ProjectRole | null {
  if (orgRole === 'owner' || orgRole === 'admin') return 'admin'
  if (orgRole === 'member') return 'editor'
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
 * Pure-ish: only touches DB, no event/session — safe to use from background
 * jobs and tests.
 */
export async function getProjectRole(
  userId: string,
  projectId: string,
): Promise<Pick<ProjectAccess, 'role' | 'source' | 'orgRole' | 'projectRole'> | null> {
  const [proj] = await db.select().from(project).where(eq(project.id, projectId))
  if (!proj) return null

  const [orgMember] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, proj.organizationId), eq(member.userId, userId)))
  const orgRole: OrgRole | null =
    orgMember?.role === 'owner' || orgMember?.role === 'admin' || orgMember?.role === 'member'
      ? orgMember.role
      : null

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
 *
 * Default `min = viewer` means "any access".
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

  const resolved = await getProjectRole(session.user.id, projectId)
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
