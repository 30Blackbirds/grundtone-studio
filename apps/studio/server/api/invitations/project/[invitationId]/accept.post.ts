import { createError, defineEventHandler, getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectInvitation, projectMember } from '~~/server/db/schema'
import { grantProjectRole } from '~~/server/lib/pdp'
import { PROJECT_ROLES, type ProjectRole } from '~~/server/lib/project-access'

function asProjectRole(role: string): ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role) ? (role as ProjectRole) : 'viewer'
}

defineRouteMeta({
  openAPI: {
    summary:
      "Accepterer en projekt-invitation: matcher JWT-email mod invitee, grant'er rolle i PDP og indsætter projektmedlem.",
    description:
      "Accepterer en projekt-invitation. Matcher den signed-in brugers JWT-email mod invitee, grant'er rollen i PDP og indsætter projektmedlemmet.",
    tags: ['Invitations'],
  },
})

export default defineEventHandler(async (event) => {
  const invitationId = getRouterParam(event, 'invitationId')
  if (!invitationId) throw createError({ statusCode: 400 })

  const actor = event.context.auth
  // Email is required to match against the invitee — reject tokens without it.
  if (!actor?.email) throw createError({ statusCode: 401, statusMessage: 'Sign in to accept' })

  const [invite] = await db
    .select()
    .from(projectInvitation)
    .where(eq(projectInvitation.id, invitationId))
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })

  if (invite.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: `Invitation is ${invite.status}` })
  }
  if (invite.expiresAt < new Date()) {
    throw createError({ statusCode: 410, statusMessage: 'Invitation expired' })
  }

  // The signed-in user's email (from the verified JWT) must match the invitee's
  // — otherwise anyone holding the invite link could redeem it for their own
  // account.
  if (actor.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: 'Invitation is for a different email' })
  }

  const role = asProjectRole(invite.role)

  // Grant in the PDP first — it's the source of truth for access. If it fails we
  // surface the error and don't flip the invite, so the user can retry.
  await grantProjectRole(event, invite.projectId, actor.sub, role)

  return db.transaction(async (tx) => {
    await tx
      .insert(projectMember)
      .values({
        projectId: invite.projectId,
        userId: actor.sub,
        memberEmail: actor.email,
        role: invite.role,
        invitedBy: invite.invitedBy,
      })
      .onConflictDoUpdate({
        target: [projectMember.projectId, projectMember.userId],
        set: { role: invite.role, memberEmail: actor.email },
      })

    await tx
      .update(projectInvitation)
      .set({ status: 'accepted' })
      .where(eq(projectInvitation.id, invite.id))

    return { projectId: invite.projectId, role: invite.role }
  })
})
