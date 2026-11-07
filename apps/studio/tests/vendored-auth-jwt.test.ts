import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createJwtVerifier } from '../server/vendor/auth-jwt/src/index'
import { JWT_CLAIM_ORG } from '../server/vendor/auth-jwt/src/claims'

/**
 * Behaviour of the vendored @klanghaus/auth-jwt verifier (KH-944). Studio owns
 * this copy now, and it runs on studio's own `jose` (6.2.12) instead of the 6.2.3
 * the package pinned, so its contract is measured here with real keys rather
 * than assumed: a valid token yields the actor, and every way a token can be
 * wrong is refused.
 */
const ISSUER = 'https://auth.example.test'
let signingKey: CryptoKey
let otherKey: CryptoKey
let jwk: JWK

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  signingKey = pair.privateKey
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }
  otherKey = (await generateKeyPair('RS256')).privateKey
})

const verifier = () =>
  createJwtVerifier({ issuer: ISSUER, keyResolver: createLocalJWKSet({ keys: [jwk] }) })

const token = (
  claims: Record<string, unknown>,
  opts: { key?: CryptoKey; iss?: string; aud?: string } = {},
) => {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
  if ('sub' in claims) jwt.setSubject(String(claims.sub))
  return jwt.sign(opts.key ?? signingKey)
}

describe('vendored auth-jwt verifier', () => {
  it('a valid token yields sub, tenant and email', async () => {
    const t = await token({ sub: 'user-1', [JWT_CLAIM_ORG]: 'org-9', email: 'a@example.test' })
    await expect(verifier().verify(t)).resolves.toEqual({
      sub: 'user-1',
      tenant: 'org-9',
      email: 'a@example.test',
    })
  })

  it('tenant is null when the org claim is absent', async () => {
    const t = await token({ sub: 'user-1' })
    await expect(verifier().verify(t)).resolves.toEqual({ sub: 'user-1', tenant: null })
  })

  it('CONTROL: a token signed by another key is refused', async () => {
    const t = await token({ sub: 'user-1' }, { key: otherKey })
    await expect(verifier().verify(t)).rejects.toThrow()
  })

  it('CONTROL: a token for another audience is refused', async () => {
    const t = await token({ sub: 'user-1' }, { aud: 'https://elsewhere.example.test' })
    await expect(verifier().verify(t)).rejects.toThrow()
  })

  it('CONTROL: a token from another issuer is refused', async () => {
    const t = await token({ sub: 'user-1' }, { iss: 'https://evil.example.test' })
    await expect(verifier().verify(t)).rejects.toThrow()
  })

  it('CONTROL: a token without sub is refused', async () => {
    const t = await token({ [JWT_CLAIM_ORG]: 'org-9' })
    await expect(verifier().verify(t)).rejects.toThrow('jwt missing sub claim')
  })
})
