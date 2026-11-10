import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { ASSIGNABLE, parseBody } from '~~/server/lib/org-membership-input'
import { changeMemberRole, membershipDeps } from '~~/server/lib/org-membership'
import { requireOrgRole } from '~~/server/lib/project-access'

// `memberId` is auth's member id, as the members page has it.

const bodySchema = z.object({ role: z.enum(ASSIGNABLE) })

defineRouteMeta({
  openAPI: { summary: "Changes a member's org role; requires org admin or higher.", tags: ['Org'] },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  const memberId = getRouterParam(event, 'memberId')
  if (!orgId || !memberId) {
    throw createError({ statusCode: 400, statusMessage: 'orgId and memberId required' })
  }
  const access = await requireOrgRole(event, orgId, 'admin')
  const { role } = parseBody(bodySchema, await readBody(event))
  return changeMemberRole(await membershipDeps(event), event, access.role, orgId, memberId, role)
})
