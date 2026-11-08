import { createLocalJWKSet, exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createJwtVerifier, JWT_ALGORITHMS, JWT_CLAIM_ORG, verifyFailureCode } from './jwt'

/**
 * The access-token verifier, measured with real keys rather than assumed: a
 * valid token yields the actor, and every way a token can be wrong is refused
 * with jose's own reason, so each refusal names the check that made it.
 * Ported from tests/vendored-auth-jwt.test.ts when the vendored package went.
 */
const ISSUER = 'https://auth.example.test'
const AUDIENCE = ISSUER
let rsaPair: CryptoKeyPair
let otherKey: CryptoKey
let jwk: JWK

beforeAll(async () => {
  rsaPair = await generateKeyPair('RS256', { extractable: true })
  jwk = { ...(await exportJWK(rsaPair.publicKey)), kid: 'k1', alg: 'RS256' }
  otherKey = (await generateKeyPair('RS256')).privateKey
})

const verifierFor = (keys: JWK[]) =>
  createJwtVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyResolver: createLocalJWKSet({ keys }),
  })
const verifier = () => verifierFor([jwk])

const token = (
  claims: Record<string, unknown>,
  // `exp: null` signs a token with no expiry at all.
  opts: { key?: CryptoKey; iss?: string; aud?: string; alg?: string; exp?: number | null } = {},
) => {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
  if (opts.exp !== null) jwt.setExpirationTime(opts.exp ?? '5m')
  if ('sub' in claims) jwt.setSubject(String(claims.sub))
  return jwt.sign(opts.key ?? rsaPair.privateKey)
}

describe('access-token verifier', () => {
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
    await expect(verifier().verify(t)).rejects.toMatchObject({
      code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    })
  })

  it('CONTROL: a token for another audience is refused', async () => {
    const t = await token({ sub: 'user-1' }, { aud: 'https://elsewhere.example.test' })
    await expect(verifier().verify(t)).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
    })
  })

  it('CONTROL: a token from another issuer is refused', async () => {
    const t = await token({ sub: 'user-1' }, { iss: 'https://evil.example.test' })
    await expect(verifier().verify(t)).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'iss',
    })
  })

  it('CONTROL: a token without sub is refused', async () => {
    const t = await token({ [JWT_CLAIM_ORG]: 'org-9' })
    await expect(verifier().verify(t)).rejects.toThrow('jwt missing sub claim')
  })
})

describe('🔴 exp is required', () => {
  it('refuses a validly signed token that carries no exp', async () => {
    const t = await token({ sub: 'user-1' }, { exp: null })
    await expect(verifier().verify(t)).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'exp',
      reason: 'missing',
    })
  })

  it('CONTROL: an expired token is still refused as expired, not as missing', async () => {
    const t = await token({ sub: 'user-1' }, { exp: Math.floor(Date.now() / 1000) - 60 })
    await expect(verifier().verify(t)).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' })
  })

  it('CONTROL: a token with a future exp still verifies', async () => {
    const t = await token({ sub: 'user-1' })
    await expect(verifier().verify(t)).resolves.toEqual({ sub: 'user-1', tenant: null })
  })
})

describe('verifyFailureCode', () => {
  it("returns jose's code for a jose error", async () => {
    const t = await token({ sub: 'user-1' }, { key: otherKey })
    const err = await verifier()
      .verify(t)
      .catch((e: unknown) => e)
    expect(verifyFailureCode(err)).toBe('ERR_JWS_SIGNATURE_VERIFICATION_FAILED')
  })

  it('returns the class name for an error without a code', () => {
    expect(verifyFailureCode(new TypeError('fetch failed'))).toBe('TypeError')
  })

  it('returns a fixed word for a thrown non-error', () => {
    expect(verifyFailureCode('a string')).toBe('non-error')
  })
})

describe('🔴 the algorithm pin', () => {
  it('pins exactly what the auth service signs with', () => {
    // auth's jwt() plugin: keyPairConfig { alg: 'RS256' }. Changing this list
    // is a deploy-coupled decision, not a refactor.
    expect(JWT_ALGORITHMS).toEqual(['RS256'])
  })

  // The two cells below use a JWK WITHOUT `alg`. With `alg` on the JWK, jose's
  // key selection already refuses another algorithm, so the pin would be
  // measured against nothing. Without it, only the pin stands between an RSA
  // key and RS512/PS256 — which is the case the pin exists for.
  const bareJwk = () => {
    const { alg: _alg, ...rest } = jwk
    return rest
  }

  it('CONTROL: the alg-less JWK still verifies an RS256 token', async () => {
    // Without this, the refusal below could be the alg-less key failing to
    // resolve at all, rather than the pin.
    const t = await token({ sub: 'user-1' })
    await expect(verifierFor([bareJwk()]).verify(t)).resolves.toEqual({
      sub: 'user-1',
      tenant: null,
    })
  })

  it.each(['RS512', 'PS256'])('refuses a %s token signed with the trusted RSA key', async (alg) => {
    // WebCrypto binds a key to one algorithm, so the SAME RSA key material is
    // re-imported under `alg`; the signature is genuinely the trusted key's.
    const sameKey = (await importJWK(await exportJWK(rsaPair.privateKey), alg)) as CryptoKey
    const t = await token({ sub: 'user-1' }, { alg, key: sameKey })
    await expect(verifierFor([bareJwk()]).verify(t)).rejects.toMatchObject({
      code: 'ERR_JOSE_ALG_NOT_ALLOWED',
    })
  })
})
