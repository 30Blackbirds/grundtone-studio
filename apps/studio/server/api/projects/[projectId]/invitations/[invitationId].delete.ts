import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectInvitation } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  const invitationId = getRouterParam(event, 'invitationId')
  if (!projectId || !invitationId) {
    throw createError({ statusCode: 400, statusMessage: 'projectId and invitationId required' })
  }

  await requireProjectAccess(event, projectId, 'admin')

  const [cancelled] = await db
    .update(projectInvitation)
    .set({ status: 'cancelled' })
    .where(and(eq(projectInvitation.id, invitationId), eq(projectInvitation.projectId, projectId)))
    .returning({ id: projectInvitation.id })

  if (!cancelled) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })

  return { id: cancelled.id }
})
