import { and, eq, ne } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectInvitation, projectMember } from '~~/server/db/schema'
import { lookupOrgById } from '~~/server/lib/org-lookup'
import { requireProjectAccess } from '~~/server/lib/project-access'

defineRouteMeta({
  openAPI: {
    summary:
      'Returnerer org-medlemmer (fra central auth) + direkte projektmedlemmer + pending invitationer.',
    description:
      'Samler org-medlemmer (fra den centrale auth) sammen med direkte projektmedlemmer og pending invitationer for projektet.',
    tags: ['Members'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId)

  // Inherited org members come from the central auth org API (Better Auth's
  // organization plugin) — studio no longer hosts the member/user tables. The
  // org API returns userId + role; name/email are only present if auth includes
  // them in the membership payload.
  const fullOrg = await lookupOrgById(event, access.organization.id)
  const orgMembers = (fullOrg?.members ?? []).map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    name: (m as { user?: { name?: string } }).user?.name ?? null,
    email: (m as { user?: { email?: string } }).user?.email ?? null,
  }))

  // Direct project members live in studio's own table, with identity
  // denormalized at invite-accept time.
  const direct = await db
    .select({
      id: projectMember.id,
      userId: projectMember.userId,
      role: projectMember.role,
      invitedBy: projectMember.invitedBy,
      createdAt: projectMember.createdAt,
      name: projectMember.memberName,
      email: projectMember.memberEmail,
    })
    .from(projectMember)
    .where(eq(projectMember.projectId, projectId))

  const pending = await db
    .select()
    .from(projectInvitation)
    .where(
      and(eq(projectInvitation.projectId, projectId), ne(projectInvitation.status, 'accepted')),
    )

  return { orgMembers, direct, pending }
})
