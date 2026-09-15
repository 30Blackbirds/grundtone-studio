import { createError, defineEventHandler, getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { project, projectInvitation } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'

defineRouteMeta({
  openAPI: {
    summary: 'Afviser en projekt-invitation (invitee-scoped, spejler accept-autorisationen).',
    description:
      'Afviser en projekt-invitation. Den signed-in brugers JWT-email skal matche invitee — ' +
      'samme regel som accept, så kun modtageren kan afvise. Giver org- og projekt-invitationer ' +
      'samme mønster (UX-audit fund #11: reject fandtes kun for org-invitationer).',
    tags: ['Invitations'],
  },
})

export default defineEventHandler(async (event) => {
  const invitationId = getRouterParam(event, 'invitationId')
  if (!invitationId) throw createError({ statusCode: 400 })

  const actor = event.context.auth
  if (!actor?.email) throw createError({ statusCode: 401, statusMessage: 'Sign in to decline' })

  const [invite] = await db
    .select()
    .from(projectInvitation)
    .where(eq(projectInvitation.id, invitationId))
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })

  if (invite.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: `Invitation is ${invite.status}` })
  }

  // Same invitee gate as accept: only the addressed email may act on the
  // invitation — link possession alone is not authority.
  if (actor.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: 'Invitation is for a different email' })
  }

  await db
    .update(projectInvitation)
    .set({ status: 'declined' })
    .where(eq(projectInvitation.id, invite.id))

  // Audited only after the status write succeeded (riff mfhvuk8515gubxh30puab9ch).
  const [proj] = await db
    .select({ organizationId: project.organizationId, name: project.name })
    .from(project)
    .where(eq(project.id, invite.projectId))
  if (proj) {
    await recordAuditEvent(event, {
      organizationId: proj.organizationId,
      action: 'project.member.invite_declined',
      targetType: 'project',
      targetId: invite.projectId,
      targetLabel: proj.name,
      after: { role: invite.role, invitationId: invite.id },
    })
  }
  return { declined: true }
})
