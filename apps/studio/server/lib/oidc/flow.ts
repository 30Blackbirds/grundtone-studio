import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, lte } from 'drizzle-orm'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import * as client from 'openid-client'
import type { Db } from '../../db'
import { oidcLogin } from '../../db/schema'
import { isSafeNext, type OidcConfig } from './config'

// Authorization code + PKCE against any OIDC provider, using the maintained
// `openid-client` for the protocol steps (state, nonce, PKCE S256, token
// exchange, ID-token signature / iss / aud / exp / nonce checks).
//
// What this file adds on top, and tests:
//   - the browser holds only a random `state` (cookie); the PKCE verifier and
//     the nonce stay in oidc_login, and the row is deleted when the callback
//     consumes it, so a callback URL works once and a stolen cookie alone is
//     worthless;
//   - the cookie value must equal the `state` in the callback, which binds the
//     callback to the browser that started the login (login CSRF);
//   - the ID token's signature is verified against the IdP's JWKS here, with the
//     algorithm pinned to OIDC_ID_TOKEN_ALG. The client library, following
//     OIDC Core 3.1.3.7, may rely on TLS alone for a token fetched straight
//     from the token endpoint and does not check the signature (measured: a
//     token signed by an unrelated key passes it), so Studio does not rely on
//     that;
//   - the redirect_uri of the token request is the configured one, never one
//     rebuilt from the request's Host header.

export const LOGIN_TTL_MS = 10 * 60 * 1000

/** Stable, log-safe reasons. Never carries a token, code or claim value. */
export type OidcLoginErrorCode =
  | 'state_mismatch'
  | 'idp_error'
  | 'login_expired_or_used'
  | 'token_exchange_failed'
  | 'missing_subject'
  | 'pkce_unsupported'
  | 'discovery_failed'
  | 'disabled'
  | 'jit_off'
  | 'domain_not_allowed'

export class OidcLoginError extends Error {
  constructor(
    readonly code: OidcLoginErrorCode,
    readonly detail?: string,
  ) {
    super(code)
    this.name = 'OidcLoginError'
  }
}

export interface VerifiedClaims {
  issuer: string
  subject: string
  email: string | null
  emailVerified: boolean
  name: string | null
  /** Values of the configured role claim (only read when a mapping is set). */
  roleValues?: string[]
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000
const discoveryCache = new Map<
  string,
  { at: number; config: client.Configuration; keys: JWTVerifyGetKey }
>()

export async function discoverWithKeys(
  cfg: OidcConfig,
  now = Date.now(),
): Promise<{ config: client.Configuration; keys: JWTVerifyGetKey }> {
  const key = [cfg.issuer, cfg.clientId, cfg.idTokenAlg, cfg.clientSecret ? 's' : 'p'].join('\n')
  const hit = discoveryCache.get(key)
  if (hit && now - hit.at < DISCOVERY_TTL_MS) return hit
  try {
    const issuerUrl = new URL(cfg.issuer)
    const config = await client.discovery(
      issuerUrl,
      cfg.clientId,
      {
        ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
        id_token_signed_response_alg: cfg.idTokenAlg,
        redirect_uri: cfg.redirectUri,
      },
      cfg.clientSecret ? client.ClientSecretPost(cfg.clientSecret) : client.None(),
      issuerUrl.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined,
    )
    const jwksUri = config.serverMetadata().jwks_uri
    if (!jwksUri) throw new Error('no jwks_uri')
    // jose caches the key set and refetches on an unknown `kid`, so a key
    // rotation at the IdP does not need a restart.
    const entry = { at: now, config, keys: createRemoteJWKSet(new URL(jwksUri)) }
    discoveryCache.set(key, entry)
    return entry
  } catch (err) {
    throw new OidcLoginError('discovery_failed', (err as { code?: string }).code ?? 'error')
  }
}

/** Discovery, cached for an hour. Throws OidcLoginError('discovery_failed'). */
export async function discover(cfg: OidcConfig, now = Date.now()): Promise<client.Configuration> {
  return (await discoverWithKeys(cfg, now)).config
}

export function clearDiscoveryCache(): void {
  discoveryCache.clear()
}

/**
 * Begin a login: store the attempt and return the IdP URL plus the `state` the
 * caller must put in the cookie. `next` that is not a same-origin relative path
 * is replaced by `/`.
 */
export async function startLogin(
  db: Db,
  cfg: OidcConfig,
  next: string | undefined,
  now = new Date(),
): Promise<{ url: string; state: string }> {
  const config = await discover(cfg, now.getTime())
  const supported = config.serverMetadata().code_challenge_methods_supported
  if (supported && !supported.includes('S256')) throw new OidcLoginError('pkce_unsupported')

  const state = client.randomState()
  const nonce = client.randomNonce()
  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)

  // Housekeeping with the write: attempts nobody finished do not accumulate.
  await db.delete(oidcLogin).where(lte(oidcLogin.expiresAt, now))
  await db.insert(oidcLogin).values({
    stateHash: hash(state),
    codeVerifier,
    nonce,
    next: isSafeNext(next) ? next : '/',
    expiresAt: new Date(now.getTime() + LOGIN_TTL_MS),
  })

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  })
  return { url: url.href, state }
}

/**
 * Finish a login. `search` is the callback's query string; `cookieState` is the
 * value of the state cookie, or undefined when the browser sent none. Returns
 * the verified claims and where to go next.
 */
export async function completeLogin(
  db: Db,
  cfg: OidcConfig,
  search: string,
  cookieState: string | undefined,
  now = new Date(),
): Promise<{ claims: VerifiedClaims; next: string; idToken: string }> {
  const params = new URLSearchParams(search)
  const state = params.get('state')
  if (!cookieState || !state || !sameString(cookieState, state)) {
    throw new OidcLoginError('state_mismatch')
  }
  if (params.has('error')) throw new OidcLoginError('idp_error', params.get('error') ?? undefined)

  // Consume the attempt in one statement: two concurrent callbacks with the
  // same state cannot both get the row.
  const [attempt] = await db
    .delete(oidcLogin)
    .where(and(eq(oidcLogin.stateHash, hash(state)), gt(oidcLogin.expiresAt, now)))
    .returning()
  if (!attempt) throw new OidcLoginError('login_expired_or_used')

  const { config, keys } = await discoverWithKeys(cfg, now.getTime())
  // The redirect_uri sent to the token endpoint is derived from this URL, so it
  // is built from the configured value, not from request headers.
  const callbackUrl = new URL(cfg.redirectUri)
  callbackUrl.search = search

  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>
  try {
    tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: attempt.codeVerifier,
      expectedState: state,
      expectedNonce: attempt.nonce,
      idTokenExpected: true,
    })
  } catch (err) {
    throw new OidcLoginError('token_exchange_failed', (err as { code?: string }).code ?? 'error')
  }

  try {
    await jwtVerify(tokens.id_token!, keys, {
      issuer: cfg.issuer,
      audience: cfg.clientId,
      algorithms: [cfg.idTokenAlg],
      requiredClaims: ['exp', 'sub'],
    })
  } catch (err) {
    throw new OidcLoginError('token_exchange_failed', (err as { code?: string }).code ?? 'error')
  }

  const idClaims = tokens.claims()
  const subject = idClaims?.sub
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new OidcLoginError('missing_subject')
  }

  let profile: Record<string, unknown> = { ...idClaims }
  // E-mail is optional in an ID token. One userinfo call fills it in, and the
  // client library refuses an answer whose `sub` differs from the ID token's.
  if (!profile.email && config.serverMetadata().userinfo_endpoint) {
    try {
      profile = {
        ...(await client.fetchUserInfo(config, tokens.access_token, subject)),
        ...profile,
      }
    } catch {
      // Without e-mail the user can still sign in; they just cannot accept an
      // e-mail invitation.
    }
  }

  return {
    claims: {
      issuer: cfg.issuer,
      subject,
      email: typeof profile.email === 'string' && profile.email ? profile.email : null,
      // Some IdPs send the string "true"; nothing else counts as verified.
      emailVerified: profile.email_verified === true || profile.email_verified === 'true',
      name: displayName(profile),
      ...(cfg.roleMapping ? { roleValues: claimValues(profile[cfg.roleMapping.claim]) } : {}),
    },
    next: isSafeNext(attempt.next) ? attempt.next : '/',
    idToken: tokens.id_token!,
  }
}

/** A claim as a list of strings: a string or an array of strings; anything else is none. */
export function claimValues(raw: unknown): string[] {
  if (typeof raw === 'string') return raw ? [raw] : []
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string' && v !== '')
  return []
}

/**
 * Where to send the browser to end the IdP's own session (RP-initiated logout),
 * or null when the IdP advertises no end_session_endpoint, in which case logout
 * is local only.
 */
export async function endSessionUrl(
  cfg: OidcConfig,
  idToken: string | null,
): Promise<string | null> {
  const config = await discover(cfg)
  if (!config.serverMetadata().end_session_endpoint) return null
  const params: Record<string, string> = {
    client_id: cfg.clientId,
    post_logout_redirect_uri: new URL('/', cfg.redirectUri).href,
  }
  if (idToken) params.id_token_hint = idToken
  return client.buildEndSessionUrl(config, params).href
}

function displayName(profile: Record<string, unknown>): string | null {
  for (const key of ['name', 'preferred_username'] as const) {
    const v = profile[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200)
  }
  const email = profile.email
  return typeof email === 'string' && email.includes('@') ? email.split('@')[0]! : null
}
