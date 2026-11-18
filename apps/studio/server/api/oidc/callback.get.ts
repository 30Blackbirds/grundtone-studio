import {
  createError,
  defineEventHandler,
  deleteCookie,
  getCookie,
  getRequestURL,
  sendRedirect,
  setCookie,
} from 'h3'
import { db } from '~~/server/db'
import {
  authMode,
  oidcSessionCookie,
  oidcStateCookie,
  readOidcConfig,
} from '~~/server/lib/oidc/config'
import { completeLogin, OidcLoginError } from '~~/server/lib/oidc/flow'
import { resolveUser } from '~~/server/lib/oidc/identity'
import { createSession } from '~~/server/lib/oidc/sessions'

// Finishes a generic OIDC login: verifies the response, maps it to a Studio user
// and starts a Studio session. Only exists in AUTH_MODE=oidc.
export default defineEventHandler(async (event) => {
  if (authMode() !== 'oidc') throw createError({ statusCode: 404 })
  const cfg = readOidcConfig()
  const cookie = oidcStateCookie(cfg)
  const cookieState = getCookie(event, cookie.name)
  // One use: whatever happens next, the cookie is spent.
  deleteCookie(event, cookie.name, { path: '/', secure: cookie.secure })
  try {
    const { claims, next, idToken } = await completeLogin(
      db,
      cfg,
      getRequestURL(event).search,
      cookieState,
    )
    const user = await resolveUser(db, cfg, claims)
    // A fresh token at every login: no session id survives from before it.
    const session = await createSession(db, cfg, { userId: user.id, idToken })
    const sessionCookie = oidcSessionCookie(cfg)
    setCookie(event, sessionCookie.name, session.token, {
      httpOnly: true,
      secure: sessionCookie.secure,
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    })
    return sendRedirect(event, next, 302)
  } catch (err) {
    if (err instanceof OidcLoginError) {
      // The reason is logged, never shown: the page says only that sign-in failed.
      console.info(`[oidc] login refused: ${err.code}${err.detail ? ` (${err.detail})` : ''}`)
      throw createError({ statusCode: 403, statusMessage: 'Sign-in failed' })
    }
    throw err
  }
})
