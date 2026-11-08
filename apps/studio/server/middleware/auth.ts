import { createJwtVerifier, verifyFailureCode } from '~~/server/lib/jwt'
import { getCookie, getRequestHeader, type H3Event } from 'h3'
import { authenticateMachineKey } from '~~/server/lib/machine-auth'
import { authenticateProvisioningKey } from '~~/server/lib/provisioning-auth'
// 🔴 THIS IMPORT MUST STAY EAGER AND UNCONDITIONAL — it is load-bearing, and
// not for the symbols it brings in.
//
// `dev-auth-bypass.ts` runs `assertBypassNotLeaked()` at module scope: a
// deployment carrying STUDIO_DEV_AUTH_BYPASS outside development REFUSES TO
// BOOT instead of quietly ignoring the variable. That guard only exists
// because Nitro loads every server middleware at startup and this line pulls
// the module in. Make it a dynamic `await import(...)` inside the handler, or
// move it behind a condition, and the leak goes silent again — WITHOUT A
// SINGLE TEST TURNING RED, because the assertion would still pass everywhere
// it is called directly.
//
// The note is repeated here rather than only in that module because the hazard
// LIVES there while the mistake would be MADE here ([sikkerhed], #292).
import {
  DEV_BYPASS_ORG,
  DEV_BYPASS_USER,
  devAuthBypassEnabled,
} from '~~/server/lib/dev-auth-bypass'

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

// The `iss` claim equals the auth service's browser-facing base URL (e.g.
// http://localhost:3002 in local Tilt). Inside a container that host is
// unreachable, so JWKS-fetch + token-exchange use AUTH_INTERNAL_URL (the
// container address, e.g. http://auth:3000) when set; in prod where the two
// coincide it falls back to AUTH_ISSUER.
function internalAuthUrl(): string | undefined {
  return process.env.AUTH_INTERNAL_URL ?? process.env.AUTH_ISSUER
}

function getVerifier(): ReturnType<typeof createJwtVerifier> {
  if (verifier) return verifier
  const issuer = process.env.AUTH_ISSUER
  const audience = process.env.AUTH_AUDIENCE
  if (!issuer || !audience) {
    throw new Error('AUTH_ISSUER and AUTH_AUDIENCE must be set')
  }
  // Validate `iss` against the public issuer, but fetch keys from the reachable
  // internal URL.
  verifier = createJwtVerifier({
    issuer,
    audience,
    jwksUrl: `${internalAuthUrl()}/.well-known/jwks.json`,
  })
  return verifier
}

function readSessionCookie(event: H3Event): string | null {
  return getCookie(event, SESSION_COOKIE) ?? getCookie(event, SESSION_COOKIE_SECURE) ?? null
}

async function exchangeCookieForToken(event: H3Event): Promise<string | null> {
  const authUrl = internalAuthUrl()
  if (!authUrl) return null

  // Forward the raw Cookie header so the auth service sees the same session the
  // browser holds. We don't reconstruct it from individual cookies — the auth
  // service may rely on cookies (signature, csrf) beyond the session token.
  const cookieHeader = getRequestHeader(event, 'cookie')
  if (!cookieHeader || !readSessionCookie(event)) return null

  try {
    const res = await $fetch<{ token?: string }>(`${authUrl}/api/auth/token`, {
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
  // 🔴 LOCAL DESIGN-REVIEW BYPASS. Three gates, evaluated in
  // server/lib/dev-auth-bypass.ts — NODE_ENV=development AND an explicit
  // STUDIO_DEV_AUTH_BYPASS=1 AND a loopback caller. Placed first because the
  // exchange below needs an auth service that does not run on a design
  // reviewer's machine; without this the endpoints 401 and every page behind
  // login renders an empty shell.
  if (devAuthBypassEnabled(event)) {
    event.context.auth = {
      sub: DEV_BYPASS_USER.id,
      tenant: DEV_BYPASS_ORG.id,
      email: DEV_BYPASS_USER.email,
    } satisfies AuthActor
    return
  }

  const token = await exchangeCookieForToken(event)
  if (!token) {
    // No browser session — a headless client may present a per-project secret
    // key (`Authorization: Bearer sk_...`). Resolve it to a machine principal.
    await authenticateMachineKey(event)
    // …and an org-scoped provisioning key (KH-964), which is a different
    // principal class: it acts on an ORGANISATION, not on one project, so it
    // populates its own context slot rather than context.auth. Both are
    // attempted because each is a no-op unless its own prefix is present.
    await authenticateProvisioningKey(event)
    return
  }

  try {
    const actor = await getVerifier().verify(token)
    event.context.auth = {
      sub: actor.sub,
      tenant: actor.tenant,
      email: actor.email,
    } satisfies AuthActor
  } catch (err) {
    // Invalid/expired token — leave context.auth undefined. The reason is
    // logged, never the token: without it an algorithm change at the auth
    // service (ERR_JOSE_ALG_NOT_ALLOWED) or an unreachable JWKS refuses every
    // login without a trace, indistinguishable from ordinary expiry.
    console.info(`[auth] access token refused: ${verifyFailureCode(err)}`)
  }
})
