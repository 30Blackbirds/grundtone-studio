import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectInvitation } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { requireProjectAccess } from '~~/server/lib/project-access'

defineRouteMeta({
  openAPI: {
    summary: 'Annullerer en pending projekt-invitation; kræver projekt-admin.',
    description:
      'Annullerer en pending projekt-invitation, så den ikke længere kan accepteres. Kræver projekt-admin.',
    tags: ['Invitations'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  const invitationId = getRouterParam(event, 'invitationId')
  if (!projectId || !invitationId) {
    throw createError({ statusCode: 400, statusMessage: 'projectId and invitationId required' })
  }

  const access = await requireProjectAccess(event, projectId, 'admin')

  const [cancelled] = await db
    .update(projectInvitation)
    .set({ status: 'cancelled' })
    .where(and(eq(projectInvitation.id, invitationId), eq(projectInvitation.projectId, projectId)))
    .returning({
      id: projectInvitation.id,
      email: projectInvitation.email,
      role: projectInvitation.role,
    })

  if (!cancelled) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })

  // Audited only after the cancellation was stored (riff mfhvuk8515gubxh30puab9ch).
  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'project.member.invite_cancelled',
    targetType: 'project',
    targetId: projectId,
    targetLabel: access.project.name,
    after: { inviteeEmail: cancelled.email, role: cancelled.role, invitationId: cancelled.id },
  })

  return { id: cancelled.id }
})
