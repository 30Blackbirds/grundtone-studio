import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { assertSameOrigin, ASSIGNABLE, parseBody } from '~~/server/lib/org-membership-input'
import { inviteMember, membershipDeps } from '~~/server/lib/org-membership'
import { requireOrgRole } from '~~/server/lib/project-access'

const bodySchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(ASSIGNABLE),
  resend: z.boolean().optional(),
})

defineRouteMeta({
  openAPI: {
    summary: 'Invites a person to the organization; requires org admin or higher.',
    tags: ['Org'],
  },
})

export default defineEventHandler(async (event) => {
  // Before anything else: a cross-origin page must not reach the cookie.
  assertSameOrigin(event)
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })
  const access = await requireOrgRole(event, orgId, 'admin')
  const body = parseBody(bodySchema, await readBody(event))
  return inviteMember(await membershipDeps(event), event, access.role, orgId, body)
})
