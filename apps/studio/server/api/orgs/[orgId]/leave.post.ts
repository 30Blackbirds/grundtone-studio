import { createError, defineEventHandler, getRouterParam } from 'h3'
import { leaveOrganization, membershipDeps } from '~~/server/lib/org-membership'

defineRouteMeta({
  openAPI: { summary: 'The caller leaves the organization.', tags: ['Org'] },
})

export default defineEventHandler(async (event) => {
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })
  // No role check: auth refuses a caller who is not a member, and refuses the
  // last owner. Studio removes only the caller's own row.
  return leaveOrganization(await membershipDeps(event), event, actor.sub, orgId)
})
