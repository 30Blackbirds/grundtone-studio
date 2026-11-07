import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { JWT_CLAIM_ORG } from './claims.js'
import type { AuthActor } from './types.js'
import { defaultJwksUrl } from './jwks-url.js'

export interface JwtVerifierOptions {
  /** Auth-service base URL (issuer + default audience). */
  issuer: string
  /** JWKS endpoint; defaults to `{issuer}/.well-known/jwks.json`. */
  jwksUrl?: string | undefined
  /** If set, `aud` claim must match. Defaults to `issuer`. */
  audience?: string | undefined
  /** Test seam — override JWKS key resolver (jose caches remote JWKS). */
  keyResolver?: JWTVerifyGetKey | undefined
}

export interface JwtVerifier {
  verify(token: string): Promise<AuthActor>
}

function extractTenant(payload: JWTPayload): string | null {
  const raw = payload[JWT_CLAIM_ORG]
  if (typeof raw === 'string' && raw.length > 0) return raw
  return null
}

function extractEmail(payload: JWTPayload): string | undefined {
  const raw = payload.email
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}

export function createJwtVerifier(options: JwtVerifierOptions): JwtVerifier {
  const jwksUrl = options.jwksUrl ?? defaultJwksUrl(options.issuer)
  const audience = options.audience ?? options.issuer
  const getKey: JWTVerifyGetKey = options.keyResolver ?? createRemoteJWKSet(new URL(jwksUrl))

  return {
    async verify(token: string): Promise<AuthActor> {
      const { payload } = await jwtVerify(token, getKey, {
        issuer: options.issuer,
        audience,
      })
      const sub = payload.sub
      if (typeof sub !== 'string' || sub.length === 0) {
        throw new Error('jwt missing sub claim')
      }
      const email = extractEmail(payload)
      const tenant = extractTenant(payload)
      return email !== undefined ? { sub, tenant, email } : { sub, tenant }
    },
  }
}
