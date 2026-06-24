import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectMember } from '~~/server/db/schema'
import { revokeProjectRole } from '~~/server/lib/pdp'
import { PROJECT_ROLES, requireProjectAccess, type ProjectRole } from '~~/server/lib/project-access'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  const memberId = getRouterParam(event, 'memberId')
  if (!projectId || !memberId) {
    throw createError({ statusCode: 400, statusMessage: 'projectId and memberId required' })
  }

  await requireProjectAccess(event, projectId, 'admin')

  const [deleted] = await db
    .delete(projectMember)
    .where(and(eq(projectMember.id, memberId), eq(projectMember.projectId, projectId)))
    .returning({
      id: projectMember.id,
      userId: projectMember.userId,
      role: projectMember.role,
    })

  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Member not found' })

  // Revoke the direct grant in the PDP (source of truth for access). The local
  // row is the denormalized projection; both must drop together.
  if ((PROJECT_ROLES as readonly string[]).includes(deleted.role)) {
    await revokeProjectRole(event, projectId, deleted.userId, deleted.role as ProjectRole)
  }

  return { id: deleted.id }
})
