import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// In AUTH_MODE=oidc the middleware resolves Studio's own session, never calls
// the Better Auth token exchange, and still lets machine keys through.
const authenticateOidcSession = vi.fn()
const authenticateMachineKey = vi.fn()
const authenticateProvisioningKey = vi.fn()
const exchange = vi.fn()

vi.mock('~~/server/lib/oidc/request', () => ({
  authenticateOidcSession: (...a: unknown[]) => authenticateOidcSession(...a),
}))
vi.mock('~~/server/lib/machine-auth', () => ({
  authenticateMachineKey: (...a: unknown[]) => authenticateMachineKey(...a),
}))
vi.mock('~~/server/lib/provisioning-auth', () => ({
  authenticateProvisioningKey: (...a: unknown[]) => authenticateProvisioningKey(...a),
}))
vi.mock('~~/server/lib/dev-auth-bypass', () => ({
  devAuthBypassEnabled: () => false,
  DEV_BYPASS_ORG: { id: 'unused' },
  DEV_BYPASS_USER: { id: 'unused', email: 'unused' },
}))
vi.mock('h3', () => ({
  getCookie: () => 'better-auth-cookie-that-must-be-ignored',
  getRequestHeader: () => 'better-auth.session_token=x',
}))

type Event = { context: { auth?: unknown } }
let handler: (e: Event) => Promise<void>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('$fetch', exchange)
  handler = (await import('./auth')).default as unknown as typeof handler
})
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'oidc')
  vi.stubEnv('AUTH_ISSUER', 'https://auth.example.test')
  vi.stubEnv('AUTH_AUDIENCE', 'https://auth.example.test')
  vi.clearAllMocks()
})
afterEach(() => vi.unstubAllEnvs())

describe('auth middleware in AUTH_MODE=oidc', () => {
  it('sets the actor from the Studio session', async () => {
    authenticateOidcSession.mockResolvedValue({ sub: 'u1', tenant: null, email: 'a@example.com' })
    const event: Event = { context: {} }
    await handler(event)
    expect(event.context.auth).toEqual({ sub: 'u1', tenant: null, email: 'a@example.com' })
    expect(authenticateMachineKey).not.toHaveBeenCalled()
  })

  it('never uses the Better Auth cookie exchange, even with that cookie present', async () => {
    authenticateOidcSession.mockResolvedValue(null)
    const event: Event = { context: {} }
    await handler(event)
    expect(exchange).not.toHaveBeenCalled()
    expect(event.context.auth).toBeUndefined()
  })

  it('without a session still tries machine and provisioning keys', async () => {
    authenticateOidcSession.mockResolvedValue(null)
    await handler({ context: {} })
    expect(authenticateMachineKey).toHaveBeenCalledOnce()
    expect(authenticateProvisioningKey).toHaveBeenCalledOnce()
  })

  it('in better-auth mode the OIDC session is not consulted', async () => {
    vi.stubEnv('AUTH_MODE', '')
    exchange.mockResolvedValue({})
    await handler({ context: {} })
    expect(authenticateOidcSession).not.toHaveBeenCalled()
  })
})
