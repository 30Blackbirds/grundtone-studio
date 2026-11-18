import { createError, defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'
import { db } from '~~/server/db'
import { authMode, oidcStateCookie, readOidcConfig } from '~~/server/lib/oidc/config'
import { LOGIN_TTL_MS, OidcLoginError, startLogin } from '~~/server/lib/oidc/flow'

// Starts a generic OIDC login. Only exists in AUTH_MODE=oidc.
export default defineEventHandler(async (event) => {
  if (authMode() !== 'oidc') throw createError({ statusCode: 404 })
  const cfg = readOidcConfig()
  const next = getQuery(event).next
  try {
    const { url, state } = await startLogin(db, cfg, typeof next === 'string' ? next : undefined)
    const cookie = oidcStateCookie(cfg)
    setCookie(event, cookie.name, state, {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: LOGIN_TTL_MS / 1000,
    })
    return sendRedirect(event, url, 302)
  } catch (err) {
    if (err instanceof OidcLoginError) {
      console.error(
        `[oidc] login could not start: ${err.code}${err.detail ? ` (${err.detail})` : ''}`,
      )
      throw createError({ statusCode: 502, statusMessage: 'Sign-in is unavailable' })
    }
    throw err
  }
})
