import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectMember } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'

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
    .returning({ id: projectMember.id })

  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Member not found' })

  return { id: deleted.id }
})
