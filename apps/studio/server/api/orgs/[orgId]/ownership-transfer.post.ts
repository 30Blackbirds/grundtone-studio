import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { assertSameOrigin, parseBody } from '~~/server/lib/org-membership-input'
import { membershipDeps, transferOwnership } from '~~/server/lib/org-membership'
import { authMode } from '~~/server/lib/oidc/config'

defineRouteMeta({
  openAPI: {
    summary: 'An owner hands ownership to another member and steps down (oidc mode only).',
    tags: ['Org'],
  },
})

const bodySchema = z.object({
  userId: z.string().min(1).max(200),
  stepDownTo: z.enum(['billing', 'member', 'admin', 'manager']).optional(),
})

export default defineEventHandler(async (event) => {
  // In better-auth mode ownership lives in the auth service; this route does not exist there.
  if (authMode() !== 'oidc') throw createError({ statusCode: 404 })
  assertSameOrigin(event)
  if (!event.context.auth) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })
  const body = parseBody(bodySchema, await readBody(event))
  return transferOwnership(await membershipDeps(event), event, orgId, body.userId, body.stepDownTo)
})
