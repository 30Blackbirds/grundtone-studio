import { createError, defineEventHandler, deleteCookie, getCookie, getRequestURL } from 'h3'
import { db } from '~~/server/db'
import { authMode, oidcStateCookie, readOidcConfig } from '~~/server/lib/oidc/config'
import { completeLogin, OidcLoginError } from '~~/server/lib/oidc/flow'
import { resolveUser } from '~~/server/lib/oidc/identity'

// Finishes a generic OIDC login: verifies the response and maps it to a Studio
// user. Only exists in AUTH_MODE=oidc.
//
// Establishing the browser session is the next change (see
// docs/design/standalone-oidc.md, "Sessions and cookies"); until then a
// successful login ends in 501 so that nothing is half-signed-in.
export default defineEventHandler(async (event) => {
  if (authMode() !== 'oidc') throw createError({ statusCode: 404 })
  const cfg = readOidcConfig()
  const cookie = oidcStateCookie(cfg)
  const cookieState = getCookie(event, cookie.name)
  // One use: whatever happens next, the cookie is spent.
  deleteCookie(event, cookie.name, { path: '/', secure: cookie.secure })
  try {
    const { claims } = await completeLogin(db, cfg, getRequestURL(event).search, cookieState)
    await resolveUser(db, cfg, claims)
  } catch (err) {
    if (err instanceof OidcLoginError) {
      // The reason is logged, never shown: the page says only that sign-in failed.
      console.info(`[oidc] login refused: ${err.code}${err.detail ? ` (${err.detail})` : ''}`)
      throw createError({ statusCode: 403, statusMessage: 'Sign-in failed' })
    }
    throw err
  }
  throw createError({
    statusCode: 501,
    statusMessage: 'Session handling is not implemented yet',
    data: { code: 'session_not_implemented' },
  })
})
