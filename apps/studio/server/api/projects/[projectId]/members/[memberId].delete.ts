import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectMember } from '~~/server/db/schema'
import { revokeProjectRole } from '~~/server/lib/pdp'
import { recordAuditEvent } from '~~/server/lib/audit'
import { PROJECT_ROLES, requireProjectAccess, type ProjectRole } from '~~/server/lib/project-access'

defineRouteMeta({
  openAPI: {
    summary: 'Fjerner et direkte projektmedlem og revoker grant i PDP; kræver projekt-admin.',
    description:
      'Fjerner et direkte projektmedlem og revoker den tilhørende grant i PDP. Kræver projekt-admin.',
    tags: ['Members'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  const memberId = getRouterParam(event, 'memberId')
  if (!projectId || !memberId) {
    throw createError({ statusCode: 400, statusMessage: 'projectId and memberId required' })
  }

  const access = await requireProjectAccess(event, projectId, 'admin')

  const [deleted] = await db
    .delete(projectMember)
    .where(and(eq(projectMember.id, memberId), eq(projectMember.projectId, projectId)))
    .returning({
      id: projectMember.id,
      userId: projectMember.userId,
      role: projectMember.role,
      memberEmail: projectMember.memberEmail,
    })

  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Member not found' })

  // Revoke the direct grant in the PDP (source of truth for access). The local
  // row is the denormalized projection; both must drop together.
  if ((PROJECT_ROLES as readonly string[]).includes(deleted.role)) {
    await revokeProjectRole(event, projectId, deleted.userId, deleted.role as ProjectRole)
  }

  // Audited after the row is deleted AND the PDP grant is revoked. If the revoke
  // throws, the request fails and no event is written (riff mfhvuk8515gubxh30puab9ch).
  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'project.member.removed',
    targetType: 'project',
    targetId: projectId,
    targetLabel: access.project.name,
    after: { role: deleted.role, memberEmail: deleted.memberEmail, memberUserId: deleted.userId },
  })
  return { id: deleted.id }
})
