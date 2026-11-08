import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'

// Verifies the central auth service's access tokens on studio's own `jose`.
// This replaces the vendored copy of @klanghaus/auth-jwt (KH-944), which was
// itself a thin wrapper around the same `jwtVerify` call and had drifted from
// its upstream (1amk32fn4a8). Studio uses one function of it, so it owns that
// function here instead of a byte-pinned copy of the whole package.

/** Org claim (Beslutning O/K). Equals the tenant/organization id. */
export const JWT_CLAIM_ORG = 'org'

// 🔴 THE PIN IS THE AUTH SERVICE'S SIGNING ALGORITHM, MEASURED, NOT ASSUMED.
// auth's jwt() plugin is configured with `keyPairConfig: { alg: 'RS256' }`
// (KlangHaus/auth src/auth/create-auth.ts), and its JWKS serves one RSA key
// with `alg: RS256`. Without the pin, jose accepts any algorithm the key TYPE
// allows: an RSA key whose JWK carries no `alg` also verifies RS384, RS512 and
// PS256-512. If auth ever rotates to another algorithm, this list must change
// in the same deploy, or every login is refused.
export const JWT_ALGORITHMS = ['RS256']

export interface JwtActor {
  sub: string
  tenant: string | null
  email?: string
}

export interface JwtVerifierOptions {
  /** Auth-service base URL; checked against `iss`. */
  issuer: string
  /** Checked against `aud`. */
  audience: string
  /** JWKS endpoint; defaults to `{issuer}/.well-known/jwks.json`. */
  jwksUrl?: string | undefined
  /** Test seam — override the key resolver (jose caches the remote JWKS). */
  keyResolver?: JWTVerifyGetKey | undefined
}

export interface JwtVerifier {
  verify(token: string): Promise<JwtActor>
}

function nonEmptyString(payload: JWTPayload, claim: string): string | undefined {
  const raw = payload[claim]
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/**
 * The reason a verification failed, safe to log: jose's error code, or the
 * error's class name for anything else (a JWKS fetch that never reached jose).
 * It takes only the error, never the token, so a log line built from it cannot
 * carry token content.
 */
export function verifyFailureCode(err: unknown): string {
  if (!(err instanceof Error)) return 'non-error'
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : err.name
}

export function createJwtVerifier(options: JwtVerifierOptions): JwtVerifier {
  const getKey =
    options.keyResolver ??
    createRemoteJWKSet(new URL(options.jwksUrl ?? `${options.issuer}/.well-known/jwks.json`))

  return {
    async verify(token: string): Promise<JwtActor> {
      const { payload } = await jwtVerify(token, getKey, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: JWT_ALGORITHMS,
        // jose checks `exp` only when present; without this a token that never
        // expires is accepted.
        requiredClaims: ['exp'],
      })
      const sub = nonEmptyString(payload, 'sub')
      if (sub === undefined) throw new Error('jwt missing sub claim')
      const tenant = nonEmptyString(payload, JWT_CLAIM_ORG) ?? null
      const email = nonEmptyString(payload, 'email')
      return email !== undefined ? { sub, tenant, email } : { sub, tenant }
    },
  }
}
