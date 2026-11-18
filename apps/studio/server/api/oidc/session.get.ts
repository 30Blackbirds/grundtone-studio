import { createError, defineEventHandler, getCookie, setResponseHeader } from 'h3'
import { db } from '~~/server/db'
import { authMode, oidcSessionCookie, readOidcConfig } from '~~/server/lib/oidc/config'
import { resolveSession } from '~~/server/lib/oidc/sessions'

// Who is signed in, for the UI. Only the fields the account pages show.
export default defineEventHandler(async (event) => {
  if (authMode() !== 'oidc') throw createError({ statusCode: 404 })
  setResponseHeader(event, 'cache-control', 'no-store')
  const cfg = readOidcConfig()
  const user = await resolveSession(db, cfg, getCookie(event, oidcSessionCookie(cfg).name))
  if (!user) return { user: null }
  return {
    user: {
      id: user.userId,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
    },
  }
})
