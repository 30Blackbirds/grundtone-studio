import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { project } from '../db/schema'
import { member, organization } from '../db/schema/auth'
import { auth } from './auth'

export interface ProjectAccess {
  userId: string
  project: typeof project.$inferSelect
  organization: typeof organization.$inferSelect
  role: string
}

/**
 * Verify the current session has access to a project. Returns project + role,
 * or throws 401/403/404.
 */
export async function requireProjectAccess(
  event: H3Event,
  projectId: string,
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

  const [memberRow] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, proj.organizationId), eq(member.userId, session.user.id)))
  if (!memberRow)
    throw createError({ statusCode: 403, statusMessage: 'Not a member of this organization' })

  return {
    userId: session.user.id,
    project: proj,
    organization: orgRow,
    role: memberRow.role,
  }
}

export function requireAdmin(role: string): void {
  if (role !== 'owner' && role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
}
