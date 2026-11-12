import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { assertSameOrigin, parseBody } from '~~/server/lib/org-membership-input'
import { createOrganization, membershipDeps } from '~~/server/lib/org-membership'

// Create an org. Auth creates it and makes the caller its owner; studio
// records that owner in org_member in the same step (server/lib/org-membership.ts).

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must match /^[a-z0-9-]+$/'),
})

defineRouteMeta({
  openAPI: {
    summary: 'Creates an organization with the caller as owner.',
    tags: ['Org'],
  },
})

export default defineEventHandler(async (event) => {
  // Before anything else: a cross-origin page must not reach the cookie.
  assertSameOrigin(event)
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const body = parseBody(bodySchema, await readBody(event))
  const org = await createOrganization(await membershipDeps(event), event, actor.sub, body)
  setResponseStatus(event, 201)
  return org
})
