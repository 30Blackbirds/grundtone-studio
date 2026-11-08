import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose'
import { JWKSTimeout } from 'jose/errors'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'

/**
 * A refused access token must leave a trace. The middleware swallows every
 * verification failure (public routes must keep working), so before this the
 * `catch {}` made an algorithm change at the auth service or an unreachable
 * JWKS refuse every login silently. These cells drive the real middleware with
 * genuine jose failures and read the line it logs: it names the reason and
 * carries no part of the token.
 */
const ISSUER = 'https://auth.example.test'

// The verifier is the real one; only its key source is swapped per cell, since
// the middleware builds it once against a remote JWKS URL.
let keyResolver: JWTVerifyGetKey
vi.mock('~~/server/lib/jwt', async (importActual) => {
  const actual = await importActual<typeof import('~~/server/lib/jwt')>()
  return {
    ...actual,
    createJwtVerifier: (options: Parameters<typeof actual.createJwtVerifier>[0]) => ({
      verify: (token: string) =>
        actual
          .createJwtVerifier({ ...options, keyResolver: (...a) => keyResolver(...a) })
          .verify(token),
    }),
  }
})
vi.mock('~~/server/lib/dev-auth-bypass', () => ({
  devAuthBypassEnabled: () => false,
  DEV_BYPASS_ORG: { id: 'unused' },
  DEV_BYPASS_USER: { id: 'unused', email: 'unused' },
}))
vi.mock('~~/server/lib/machine-auth', () => ({ authenticateMachineKey: vi.fn() }))
vi.mock('~~/server/lib/provisioning-auth', () => ({ authenticateProvisioningKey: vi.fn() }))
vi.mock('h3', () => ({
  getCookie: (event: FakeEvent, name: string) => event.cookies[name],
  getRequestHeader: (event: FakeEvent, name: string) => event.headers[name.toLowerCase()],
}))

interface FakeEvent {
  cookies: Record<string, string>
  headers: Record<string, string>
  context: { auth?: unknown }
}
const sessionEvent = (): FakeEvent => ({
  cookies: { 'better-auth.session_token': 'session' },
  headers: { cookie: 'better-auth.session_token=session' },
  context: {},
})

let rsaPair: CryptoKeyPair
let jwk: JWK
let exchanged: string
let handler: (event: FakeEvent) => Promise<void>
let info: MockInstance<typeof console.info>

beforeAll(async () => {
  vi.stubEnv('AUTH_ISSUER', ISSUER)
  vi.stubEnv('AUTH_AUDIENCE', ISSUER)
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('$fetch', () => Promise.resolve({ token: exchanged }))
  rsaPair = await generateKeyPair('RS256', { extractable: true })
  // No `alg` on the JWK, so the pin, not key selection, refuses RS512.
  jwk = { ...(await exportJWK(rsaPair.publicKey)), kid: 'k1' }
  handler = (await import('./auth')).default as unknown as typeof handler
})

beforeEach(() => {
  keyResolver = createLocalJWKSet({ keys: [jwk] })
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => info.mockRestore())

const sign = async (opts: { alg?: string; exp?: number } = {}) => {
  const alg = opts.alg ?? 'RS256'
  const key =
    alg === 'RS256' ? rsaPair.privateKey : await importJWK(await exportJWK(rsaPair.privateKey), alg)
  return new SignJWT({ sub: 'user-1' })
    .setProtectedHeader({ alg, kid: 'k1' })
    .setSubject('user-1')
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setExpirationTime(opts.exp ?? '5m')
    .sign(key)
}

const runWith = async (token: string) => {
  exchanged = token
  const event = sessionEvent()
  await handler(event)
  return { event, lines: info.mock.calls.map((c) => c.join(' ')) }
}

describe('🔴 a refused access token is logged by reason, never by content', () => {
  it('CONTROL: a valid token sets the actor and logs nothing', async () => {
    const { event, lines } = await runWith(await sign())
    expect(event.context.auth).toMatchObject({ sub: 'user-1' })
    expect(lines).toEqual([])
  })

  it.each([
    ['an algorithm outside the pin', () => sign({ alg: 'RS512' }), 'ERR_JOSE_ALG_NOT_ALLOWED'],
    [
      'an expired token',
      () => sign({ exp: Math.floor(Date.now() / 1000) - 60 }),
      'ERR_JWT_EXPIRED',
    ],
  ])('%s logs its code', async (_label, make, code) => {
    const token = await make()
    const { event, lines } = await runWith(token)
    expect(event.context.auth).toBeUndefined()
    expect(lines).toEqual([`[auth] access token refused: ${code}`])
    for (const segment of token.split('.')) expect(lines[0]).not.toContain(segment)
  })

  it('a JWKS that cannot be fetched logs a code distinct from expiry', async () => {
    keyResolver = () => {
      throw new JWKSTimeout()
    }
    const token = await sign()
    const { event, lines } = await runWith(token)
    expect(event.context.auth).toBeUndefined()
    expect(lines).toEqual(['[auth] access token refused: ERR_JWKS_TIMEOUT'])
    for (const segment of token.split('.')) expect(lines[0]).not.toContain(segment)
  })
})
