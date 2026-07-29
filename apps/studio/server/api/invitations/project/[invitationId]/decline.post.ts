import { createError, defineEventHandler, getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectInvitation } from '~~/server/db/schema'

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

  return { declined: true }
})
