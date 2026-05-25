import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectInvitation, projectMember } from '~~/server/db/schema'
import { user as userTable } from '~~/server/db/schema/auth'
import { auth } from '~~/server/lib/auth'
import { PROJECT_INVITATION_STATUS } from '~~/server/lib/constants'

export default defineEventHandler(async (event) => {
  const invitationId = getRouterParam(event, 'invitationId')
  if (!invitationId) throw createError({ statusCode: 400 })

  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sign in to accept' })

  const [invite] = await db
    .select()
    .from(projectInvitation)
    .where(eq(projectInvitation.id, invitationId))
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })

  if (invite.status !== PROJECT_INVITATION_STATUS.PENDING) {
    throw createError({ statusCode: 409, statusMessage: `Invitation is ${invite.status}` })
  }
  if (invite.expiresAt < new Date()) {
    throw createError({ statusCode: 410, statusMessage: 'Invitation expired' })
  }

  // The signed-in user's email must match the invitee's email — otherwise the
  // signed-in person could hijack any invitation link they get hold of.
  const [signedInUser] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, session.user.id))
  if (signedInUser?.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: 'Invitation is for a different email' })
  }

  return db.transaction(async (tx) => {
    await tx
      .insert(projectMember)
      .values({
        projectId: invite.projectId,
        userId: session.user.id,
        role: invite.role,
        invitedBy: invite.invitedBy,
      })
      .onConflictDoUpdate({
        target: [projectMember.projectId, projectMember.userId],
        set: { role: invite.role },
      })

    await tx
      .update(projectInvitation)
      .set({ status: PROJECT_INVITATION_STATUS.ACCEPTED })
      .where(eq(projectInvitation.id, invite.id))

    return { projectId: invite.projectId, role: invite.role }
  })
})
