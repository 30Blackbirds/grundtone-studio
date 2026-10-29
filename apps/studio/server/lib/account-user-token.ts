import { createError, getRequestHeader, type H3Event } from 'h3'

// The user token account's billing mints require (Allan 2026-10-28: «(a)
// gælder: kunden skal læses fra brugerens login-session via auth»). Studio's
// S2S bearer says WHICH SERVICE calls; this token says which logged-in user,
// in which org, with which role, asked for it. Account checks that its `org`
// equals the request's tenantOrgId and that `org_role` holds owner or billing
// (account src/http/user-binding.ts). Studio mints one per billing request and
// never caches it: it lives 300 s and is a one-request credential.
//
// Minted by auth (auth#194, `POST /api/auth/account-user-token`) from the
// user's BetterAuth session cookie — the same Cookie header Studio already
// forwards to /api/auth/token and the organization endpoints.
//
// 🔴 Unlike those GETs, this is a cookie-bearing POST, so auth's CSRF check
// requires an Origin, and a server-side fetch sends none. Studio sends its own
// public origin, which must be in auth's trustedOrigins. Auth answers a
// missing or untrusted Origin with 403 too, but that is OUR configuration,
// not the user lacking access — so it becomes a 502, never a "no access".

const PATH = '/api/auth/account-user-token'

/** auth's error codes (BetterAuth's `{ code, message }`), pinned in auth#194. */
const NOT_A_MEMBER = 'ACCOUNT_USER_TOKEN_NOT_A_MEMBER'
const ORIGIN_CODES = new Set(['MISSING_OR_NULL_ORIGIN', 'INVALID_ORIGIN'])

function authBase(): string {
  // Server-side → the container-internal address when set. `||`, not `??`, as
  // the BFF proxy (server/api/auth/[...].ts) chose: an EMPTY AUTH_INTERNAL_URL
  // must fall back to the issuer too, not become a bare path ([infra] on #370).
  const base = process.env.AUTH_INTERNAL_URL || process.env.AUTH_ISSUER
  if (!base) throw new Error('AUTH_INTERNAL_URL or AUTH_ISSUER must be set')
  return base
}

/** How auth's answer is read. Exported for the cells. */
export function classifyUserTokenResponse(
  status: number,
  body: unknown,
): { kind: 'token'; token: string } | { kind: 'error'; error: ReturnType<typeof createError> } {
  const b = (body ?? {}) as { token?: unknown; code?: unknown }
  if (status === 200 && typeof b.token === 'string' && b.token.length > 0) {
    return { kind: 'token', token: b.token }
  }
  if (status === 401) {
    return {
      kind: 'error',
      error: createError({
        statusCode: 401,
        statusMessage: 'Session expired',
        data: { code: 'session_expired' },
      }),
    }
  }
  if (status === 403 && b.code === NOT_A_MEMBER) {
    return {
      kind: 'error',
      error: createError({
        statusCode: 403,
        statusMessage: 'Not a member of this organization',
        data: { code: 'not_a_member' },
      }),
    }
  }
  if (status === 403 && typeof b.code === 'string' && ORIGIN_CODES.has(b.code)) {
    console.error(
      `[account-user-token] auth refused Studio's Origin (${b.code}): check that ` +
        "runtimeConfig.public.appUrl's origin is in auth's trustedOrigins",
    )
  } else {
    console.error(`[account-user-token] auth answered ${status}:`, JSON.stringify(body))
  }
  return {
    kind: 'error',
    error: createError({
      statusCode: 502,
      statusMessage: 'Could not confirm your billing access',
      data: { code: 'user_token_unavailable' },
    }),
  }
}

/**
 * Mints the account user token for `orgId` from the caller's session. Throws
 * an H3 error: 401 when the session is gone, 403 when auth says the user is not
 * a member, 502 for anything that is Studio's or auth's fault.
 */
export async function mintAccountUserToken(event: H3Event, orgId: string): Promise<string> {
  const cookie = getRequestHeader(event, 'cookie')
  if (!cookie) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Session expired',
      data: { code: 'session_expired' },
    })
  }
  const origin = new URL(useRuntimeConfig(event).public.appUrl).origin
  let res: Response
  try {
    res = await fetch(`${authBase()}${PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify({ orgId }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.error('[account-user-token] auth unreachable:', err)
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not confirm your billing access',
      data: { code: 'user_token_unavailable' },
    })
  }
  const outcome = classifyUserTokenResponse(res.status, await res.json().catch(() => null))
  if (outcome.kind === 'error') throw outcome.error
  return outcome.token
}
