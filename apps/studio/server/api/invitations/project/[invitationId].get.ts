import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { project, projectInvitation } from '~~/server/db/schema'
import { organization } from '~~/server/db/schema/auth'

// Public lookup so the invitee can preview the invite before signing in.
// Status-checked but does NOT consume the invitation.
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
      organizationName: organization.name,
    })
    .from(projectInvitation)
    .innerJoin(project, eq(project.id, projectInvitation.projectId))
    .innerJoin(organization, eq(organization.id, project.organizationId))
    .where(eq(projectInvitation.id, invitationId))

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })

  const expired = row.expiresAt < new Date()
  return { ...row, expired }
})
