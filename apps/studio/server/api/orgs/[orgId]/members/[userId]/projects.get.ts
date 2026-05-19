import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { project, projectMember } from '~~/server/db/schema'
import { requireOrgRole } from '~~/server/lib/project-access'

// Direct project memberships for a specific user within a specific org.
// Used by the org member detail page to show which projects they're a
// direct member of (in addition to whatever their org role grants).
export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  const userId = getRouterParam(event, 'userId')
  if (!orgId || !userId) throw createError({ statusCode: 400 })

  // Anyone in the org can see who's on what project; org membership is the
  // only gate. Mutations (add/remove project members) live in the project
  // endpoints and gate on requireProjectAccess(event, projectId, 'admin').
  await requireOrgRole(event, orgId, 'member')

  return await db
    .select({
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      role: projectMember.role,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(and(eq(project.organizationId, orgId), eq(projectMember.userId, userId)))
})
