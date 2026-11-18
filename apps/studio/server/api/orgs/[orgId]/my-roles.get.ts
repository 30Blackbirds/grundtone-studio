import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { db } from '~~/server/db'
import { myRolesLocal } from '~~/server/lib/org-membership-local'
import { authMode } from '~~/server/lib/oidc/config'

defineRouteMeta({
  openAPI: {
    summary: "The caller's org role and the roles it may assign (oidc mode only).",
    tags: ['Org'],
  },
})

export default defineEventHandler(async (event) => {
  if (authMode() !== 'oidc') throw createError({ statusCode: 404 })
  if (!event.context.auth) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })
  setResponseHeader(event, 'cache-control', 'no-store')
  return myRolesLocal(db, event, orgId)
})
