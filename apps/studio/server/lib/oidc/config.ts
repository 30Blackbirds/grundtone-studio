// Configuration of the generic OIDC login (AUTH_MODE=oidc). Pure: it reads an
// environment object it is handed and either returns a validated config or
// throws OidcConfigError with a message that names the variable. See
// docs/design/standalone-oidc.md.

export type AuthMode = 'better-auth' | 'oidc'

export class OidcConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OidcConfigError'
  }
}

type Env = Record<string, string | undefined>

export interface OidcConfig {
  issuer: string
  clientId: string
  /** Absent: a public client that authenticates with PKCE only. */
  clientSecret: string | undefined
  scopes: string[]
  redirectUri: string
  /** The one ID-token signing algorithm accepted. Never `none`, never HMAC. */
  idTokenAlg: string
  requireEmailVerified: boolean
  allowedEmailDomains: string[]
  jit: boolean
  /** A session ends after this long without a request. */
  sessionIdleMs: number
  /** A session ends this long after login, however active. */
  sessionMaxMs: number
  /**
   * Optional, OFF unless both OIDC_ROLE_CLAIM and OIDC_ROLE_MAP are set: org
   * roles granted from an IdP claim at login. Never owner; a role assigned in
   * Studio always wins over one from the claim.
   */
  roleMapping: RoleMapping | null
}

export type ClaimRole = 'billing' | 'member' | 'admin' | 'manager'
export interface RoleMapping {
  claim: string
  /** claim value -> grants (org slug + role). */
  grants: Map<string, Array<{ orgSlug: string; role: ClaimRole }>>
}

const CLAIM_ROLES: readonly ClaimRole[] = ['billing', 'member', 'admin', 'manager']

/**
 * `OIDC_ROLE_MAP` is a comma-separated list of `value=org-slug:role`, e.g.
 * `studio-admins=acme:admin,acme-billing=acme:billing`. Owner is refused here:
 * ownership is only ever given inside Studio.
 */
export function parseRoleMapping(
  claimRaw: string | undefined,
  mapRaw: string | undefined,
): RoleMapping | null {
  const claim = claimRaw?.trim()
  const map = mapRaw?.trim()
  if (!claim && !map) return null
  if (!claim || !map) {
    throw new OidcConfigError('OIDC_ROLE_CLAIM and OIDC_ROLE_MAP must be set together (or neither)')
  }
  if (!/^[A-Za-z0-9_.:/-]{1,100}$/.test(claim)) {
    throw new OidcConfigError('OIDC_ROLE_CLAIM must be a plain claim name')
  }
  const grants = new Map<string, Array<{ orgSlug: string; role: ClaimRole }>>()
  for (const entry of map
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const m = /^([^=\s]{1,200})=([a-z0-9-]{1,100}):([a-z]+)$/.exec(entry)
    if (!m)
      throw new OidcConfigError(
        `OIDC_ROLE_MAP entry ${JSON.stringify(entry)} must be value=org-slug:role`,
      )
    const [, value, orgSlug, role] = m as unknown as [string, string, string, string]
    if (!CLAIM_ROLES.includes(role as ClaimRole)) {
      throw new OidcConfigError(
        `OIDC_ROLE_MAP role ${JSON.stringify(role)} must be one of ${CLAIM_ROLES.join(', ')} (never owner)`,
      )
    }
    const list = grants.get(value) ?? []
    list.push({ orgSlug, role: role as ClaimRole })
    grants.set(value, list)
  }
  if (grants.size === 0) throw new OidcConfigError('OIDC_ROLE_MAP has no entries')
  return { claim, grants }
}

const ASYMMETRIC_ALGS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]

/**
 * Which identity source this process uses. Unset means `better-auth`, so an
 * existing deployment needs no change; an unknown value refuses to start rather
 * than quietly falling back to the other mode.
 */
export function authMode(env: Env = process.env): AuthMode {
  const raw = env.AUTH_MODE?.trim()
  if (raw === undefined || raw === '') return 'better-auth'
  if (raw === 'better-auth' || raw === 'oidc') return raw
  throw new OidcConfigError(
    `refusing to start: AUTH_MODE is ${JSON.stringify(raw)}; set it to better-auth or oidc.`,
  )
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function parseUrl(name: string, value: string, allowHttpLoopback = true): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OidcConfigError(`${name} is not a valid URL`)
  }
  const httpOk = allowHttpLoopback && url.protocol === 'http:' && isLoopbackHost(url.hostname)
  if (url.protocol !== 'https:' && !httpOk) {
    throw new OidcConfigError(`${name} must be https (http is accepted only for localhost)`)
  }
  if (url.username || url.password) {
    throw new OidcConfigError(`${name} must not contain credentials`)
  }
  return url
}

function flag(name: string, value: string | undefined, fallback: boolean): boolean {
  const raw = value?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true' || raw === 'on' || raw === '1') return true
  if (raw === 'false' || raw === 'off' || raw === '0') return false
  throw new OidcConfigError(`${name} must be true/on/1 or false/off/0`)
}

function hours(name: string, value: string | undefined, fallback: number, max: number, unit = 1) {
  const raw = value?.trim()
  const n = raw ? Number(raw) : fallback
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new OidcConfigError(`${name} must be a whole number from 1 to ${max}`)
  }
  return n * unit * 60 * 60 * 1000
}

/**
 * Validate the OIDC variables. Call it only when authMode() is `oidc`.
 * `authorizer` is checked here because in oidc mode Studio's own tables are the
 * only place roles can live.
 */
export function readOidcConfig(env: Env = process.env): OidcConfig {
  if (env.AUTHORIZER !== 'local') {
    throw new OidcConfigError(
      "AUTH_MODE=oidc requires AUTHORIZER=local: roles live in Studio's own database",
    )
  }
  const issuerRaw = env.OIDC_ISSUER?.trim()
  if (!issuerRaw) throw new OidcConfigError('OIDC_ISSUER is required')
  const issuerUrl = parseUrl('OIDC_ISSUER', issuerRaw)
  if (issuerUrl.search || issuerUrl.hash) {
    throw new OidcConfigError('OIDC_ISSUER must not carry a query string or fragment')
  }
  // The issuer is compared as a string against the IdP's metadata and ID
  // token, so it is kept exactly as configured, apart from surrounding space.
  const issuer = issuerRaw

  const clientId = env.OIDC_CLIENT_ID?.trim()
  if (!clientId) throw new OidcConfigError('OIDC_CLIENT_ID is required')
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() || undefined

  const scopes = (env.OIDC_SCOPES?.trim() || 'openid email profile').split(/\s+/)
  if (!scopes.includes('openid')) throw new OidcConfigError('OIDC_SCOPES must include openid')
  if (scopes.includes('offline_access')) {
    throw new OidcConfigError(
      'OIDC_SCOPES must not include offline_access: Studio never uses refresh tokens',
    )
  }

  const appUrl = env.NUXT_PUBLIC_APP_URL?.trim()
  const redirectRaw =
    env.OIDC_REDIRECT_URI?.trim() ||
    (appUrl ? `${appUrl.replace(/\/+$/, '')}/api/oidc/callback` : '')
  if (!redirectRaw) {
    throw new OidcConfigError('OIDC_REDIRECT_URI is required when NUXT_PUBLIC_APP_URL is not set')
  }
  const redirectUri = parseUrl('OIDC_REDIRECT_URI', redirectRaw).toString()

  const idTokenAlg = env.OIDC_ID_TOKEN_ALG?.trim() || 'RS256'
  if (!ASYMMETRIC_ALGS.includes(idTokenAlg)) {
    throw new OidcConfigError(`OIDC_ID_TOKEN_ALG must be one of ${ASYMMETRIC_ALGS.join(', ')}`)
  }

  const allowedEmailDomains = (env.OIDC_ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)

  return {
    issuer,
    clientId,
    clientSecret,
    scopes,
    redirectUri,
    idTokenAlg,
    requireEmailVerified: flag(
      'OIDC_REQUIRE_EMAIL_VERIFIED',
      env.OIDC_REQUIRE_EMAIL_VERIFIED,
      true,
    ),
    allowedEmailDomains,
    jit: flag('OIDC_JIT', env.OIDC_JIT, true),
    sessionIdleMs: hours('OIDC_SESSION_IDLE_HOURS', env.OIDC_SESSION_IDLE_HOURS, 8, 24 * 30),
    sessionMaxMs: hours('OIDC_SESSION_MAX_DAYS', env.OIDC_SESSION_MAX_DAYS, 7, 365, 24),
    roleMapping: parseRoleMapping(env.OIDC_ROLE_CLAIM, env.OIDC_ROLE_MAP),
  }
}

/** True for a same-origin relative path: `/x`, never `//x`, `/\x` or an absolute URL. */
export function isSafeNext(value: string | undefined | null): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return false
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f\\]/.test(value)
}

/**
 * The cookie that binds a callback to the browser that began the login. The
 * `__Host-` prefix (Secure, Path=/, no Domain) is used whenever the app is
 * served over https; plain-http localhost development gets the bare name
 * because browsers refuse a Secure cookie there.
 */
export function oidcStateCookie(cfg: Pick<OidcConfig, 'redirectUri'>): {
  name: string
  secure: boolean
} {
  const secure = new URL(cfg.redirectUri).protocol === 'https:'
  return { name: secure ? '__Host-studio_oidc' : 'studio_oidc', secure }
}

/** The session cookie. Same `__Host-` rule as the state cookie. */
export function oidcSessionCookie(cfg: Pick<OidcConfig, 'redirectUri'>): {
  name: string
  secure: boolean
} {
  const secure = new URL(cfg.redirectUri).protocol === 'https:'
  return { name: secure ? '__Host-studio_session' : 'studio_session', secure }
}
