import { eq, and, ne } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectMember, projectInvitation } from '~~/server/db/schema'
import { member, user } from '~~/server/db/schema/auth'
import { requireProjectAccess } from '~~/server/lib/project-access'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId)

  // Inherited: every org-member of the project's parent org sees the project
  // via their org role.
  const orgMembers = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
      name: user.name,
      email: user.email,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, access.organization.id))

  // Direct: scoped to the project itself.
  const direct = await db
    .select({
      id: projectMember.id,
      userId: projectMember.userId,
      role: projectMember.role,
      invitedBy: projectMember.invitedBy,
      createdAt: projectMember.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(eq(projectMember.projectId, projectId))

  const pending = await db
    .select()
    .from(projectInvitation)
    .where(
      and(eq(projectInvitation.projectId, projectId), ne(projectInvitation.status, 'accepted')),
    )

  return { orgMembers, direct, pending }
})
