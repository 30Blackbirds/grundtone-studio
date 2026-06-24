import { createJwtVerifier } from '@klanghaus/auth-jwt'
import { getCookie, getRequestHeader, type H3Event } from 'h3'

// Studio no longer runs Better Auth. Authentication is delegated to the central
// auth service: the browser holds a `better-auth.session_token` cookie scoped to
// the auth origin and, because the auth client talks to that origin directly,
// the cookie is also forwarded to studio on same-site navigations. This
// middleware exchanges that session cookie for a short-lived JWT at
// {AUTH_ISSUER}/api/auth/token, verifies it locally against the cached JWKS, and
// stashes the resolved actor on event.context.auth.
//
// On any failure we leave event.context.auth undefined and let route guards
// (requireProjectAccess / requireOrgRole and the per-endpoint 401 checks) reject
// the request. We never throw here — public endpoints (healthz, the CDN /k and
// /client routes, invitation previews) must keep working without a session.

export interface AuthActor {
  sub: string
  // Org claim (Beslutning O/K). Equals the tenant/organization id. Null when the
  // user has no active organization — org-scoped routes must guard on this.
  tenant: string | null
  email?: string
}

// Better Auth sets the session cookie under this name; in production it's
// prefixed with `__Secure-`. We read both so local (http) and prod (https)
// behave the same.
const SESSION_COOKIE = 'better-auth.session_token'
const SESSION_COOKIE_SECURE = '__Secure-better-auth.session_token'

// jose's createRemoteJWKSet (inside the verifier) caches the JWKS, so a single
// module-level verifier survives auth-service blips. Lazily constructed so a
// missing env var surfaces on first authenticated request rather than at import.
let verifier: ReturnType<typeof createJwtVerifier> | null = null

function getVerifier(): ReturnType<typeof createJwtVerifier> {
  if (verifier) return verifier
  const issuer = process.env.AUTH_ISSUER
  const audience = process.env.AUTH_AUDIENCE
  if (!issuer || !audience) {
    throw new Error('AUTH_ISSUER and AUTH_AUDIENCE must be set')
  }
  verifier = createJwtVerifier({ issuer, audience })
  return verifier
}

function readSessionCookie(event: H3Event): string | null {
  return getCookie(event, SESSION_COOKIE) ?? getCookie(event, SESSION_COOKIE_SECURE) ?? null
}

async function exchangeCookieForToken(event: H3Event): Promise<string | null> {
  const issuer = process.env.AUTH_ISSUER
  if (!issuer) return null

  // Forward the raw Cookie header so the auth service sees the same session the
  // browser holds. We don't reconstruct it from individual cookies — the auth
  // service may rely on cookies (signature, csrf) beyond the session token.
  const cookieHeader = getRequestHeader(event, 'cookie')
  if (!cookieHeader || !readSessionCookie(event)) return null

  try {
    const res = await $fetch<{ token?: string }>(`${issuer}/api/auth/token`, {
      headers: { cookie: cookieHeader },
    })
    return res.token ?? null
  } catch {
    // No active session, or auth service unreachable for the exchange. Treat as
    // unauthenticated; downstream guards 401.
    return null
  }
}

export default defineEventHandler(async (event) => {
  const token = await exchangeCookieForToken(event)
  if (!token) return

  try {
    const actor = await getVerifier().verify(token)
    event.context.auth = {
      sub: actor.sub,
      tenant: actor.tenant,
      email: actor.email,
    } satisfies AuthActor
  } catch {
    // Invalid/expired token — leave context.auth undefined.
  }
})
