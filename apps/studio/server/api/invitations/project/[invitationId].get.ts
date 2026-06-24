import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { project, projectInvitation } from '~~/server/db/schema'

// Public lookup so the invitee can preview the invite before signing in.
// Status-checked but does NOT consume the invitation.
//
// Org name is intentionally omitted: this endpoint is unauthenticated, and org
// identity now lives in the central auth service which we can only query with a
// session cookie. The preview shows the project name (studio-owned); the org
// context is conveyed in the invite email itself.
defineRouteMeta({
  openAPI: {
    summary:
      'Offentlig preview af en projekt-invitation (status/rolle/projektnavn) før login; forbruger ikke invitationen.',
    description:
      'Uautentificeret opslag der lader invitee se status, rolle og projektnavn for en invitation før login. Forbruger ikke invitationen.',
    tags: ['Invitations'],
  },
})

export default defineEventHandler(async (event) => {
  const invitationId = getRouterParam(event, 'invitationId')
  if (!invitationId) throw createError({ statusCode: 400 })

  const [row] = await db
    .select({
      id: projectInvitation.id,
      email: projectInvitation.email,
      role: projectInvitation.role,
      status: projectInvitation.status,
      expiresAt: projectInvitation.expiresAt,
      projectId: projectInvitation.projectId,
      projectName: project.name,
    })
    .from(projectInvitation)
    .innerJoin(project, eq(project.id, projectInvitation.projectId))
    .where(eq(projectInvitation.id, invitationId))

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })

  const expired = row.expiresAt < new Date()
  return { ...row, expired }
})
