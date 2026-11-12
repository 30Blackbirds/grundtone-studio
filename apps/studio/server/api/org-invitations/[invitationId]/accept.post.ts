import { createError, defineEventHandler, getRouterParam } from 'h3'
import { acceptInvitation, membershipDeps } from '~~/server/lib/org-membership'
import { assertSameOrigin } from '~~/server/lib/org-membership-input'

// Accept an org invitation. The invitation lives in auth, so one created before
// this route existed is accepted here the same way; the role studio records is
// the one auth returns.

defineRouteMeta({
  openAPI: { summary: 'Accepts an organization invitation for the caller.', tags: ['Org'] },
})

export default defineEventHandler(async (event) => {
  // Before anything else: a cross-origin page must not reach the cookie.
  assertSameOrigin(event)
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const invitationId = getRouterParam(event, 'invitationId')
  if (!invitationId) throw createError({ statusCode: 400, statusMessage: 'invitationId required' })
  return acceptInvitation(await membershipDeps(event), event, actor.sub, invitationId)
})
