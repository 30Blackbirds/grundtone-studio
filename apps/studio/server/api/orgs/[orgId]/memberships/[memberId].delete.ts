import { createError, defineEventHandler, getRouterParam } from 'h3'
import { membershipDeps, removeMember } from '~~/server/lib/org-membership'
import { requireOrgRole } from '~~/server/lib/project-access'

defineRouteMeta({
  openAPI: {
    summary: 'Removes a member from the organization; requires org admin or higher.',
    tags: ['Org'],
  },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  const memberId = getRouterParam(event, 'memberId')
  if (!orgId || !memberId) {
    throw createError({ statusCode: 400, statusMessage: 'orgId and memberId required' })
  }
  const access = await requireOrgRole(event, orgId, 'admin')
  return removeMember(await membershipDeps(event), event, access.role, orgId, memberId)
})
