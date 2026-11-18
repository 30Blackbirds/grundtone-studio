import { createError, defineEventHandler, deleteCookie, getCookie, sendRedirect } from 'h3'
import { db } from '~~/server/db'
import { assertSameOrigin } from '~~/server/lib/org-membership-input'
import { authMode, oidcSessionCookie, readOidcConfig } from '~~/server/lib/oidc/config'
import { endSessionUrl } from '~~/server/lib/oidc/flow'
import { destroySession } from '~~/server/lib/oidc/sessions'

// Ends the Studio session, then, if the IdP has an end_session_endpoint, sends
// the browser there (RP-initiated logout). Otherwise logout is local only.
export default defineEventHandler(async (event) => {
  if (authMode() !== 'oidc') throw createError({ statusCode: 404 })
  assertSameOrigin(event)
  const cfg = readOidcConfig()
  const cookie = oidcSessionCookie(cfg)
  const idToken = await destroySession(db, getCookie(event, cookie.name))
  deleteCookie(event, cookie.name, { path: '/', secure: cookie.secure })
  let target = '/'
  try {
    target = (await endSessionUrl(cfg, idToken)) ?? '/'
  } catch {
    // The IdP being unreachable must not keep the user signed in here.
  }
  return sendRedirect(event, target, 303)
})
