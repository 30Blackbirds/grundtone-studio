import { createError, defineEventHandler, getRouterParam } from 'h3'
import { deleteOrganization, membershipDeps } from '~~/server/lib/org-membership'
import { requireOrgRole } from '~~/server/lib/project-access'
import { assertSameOrigin } from '~~/server/lib/org-membership-input'

// Delete an org. Its org_member rows go in the same transaction, before auth
// is asked, so a deleted org leaves no role behind in studio.

defineRouteMeta({
  openAPI: { summary: 'Deletes an organization; requires org owner.', tags: ['Org'] },
})

export default defineEventHandler(async (event) => {
  // Before anything else: a cross-origin page must not reach the cookie.
  assertSameOrigin(event)
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })
  // Auth decides too; asking first keeps a caller who may not delete from
  // removing studio's rows while auth's answer is still unknown.
  await requireOrgRole(event, orgId, 'owner')
  return deleteOrganization(await membershipDeps(event), event, orgId)
})
