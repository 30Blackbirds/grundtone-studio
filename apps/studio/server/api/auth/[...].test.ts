import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// h3 mockes minimalt: handleren er ren wiring (target-opløsning + proxyRequest-
// kald), så testen dækker netop den logik — env-fallback, 502-guard og at
// path+query føres uændret videre til upstream.
const proxyRequestMock = vi.fn<(event: unknown, target: string) => Promise<unknown>>()
vi.mock('h3', () => ({
  defineEventHandler: (fn: unknown) => fn,
  createError: (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input.statusMessage), input),
  proxyRequest: (event: unknown, target: string) => proxyRequestMock(event, target),
}))

const handler = (await import('./[...]')).default as unknown as (event: {
  path: string
}) => Promise<unknown>

beforeEach(() => {
  proxyRequestMock.mockReset()
  proxyRequestMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/api/auth/[...] BFF-proxy', () => {
  it('502s when no auth target is configured', () => {
    vi.stubEnv('AUTH_INTERNAL_URL', '')
    vi.stubEnv('AUTH_ISSUER', '')
    // Handleren er synkron — 502'eren kastes før proxyRequest overhovedet nås.
    let thrown: unknown
    try {
      handler({ path: '/api/auth/get-session' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toMatchObject({ statusCode: 502 })
    expect(proxyRequestMock).not.toHaveBeenCalled()
  })

  it('proxies to AUTH_ISSUER preserving path and query', async () => {
    vi.stubEnv('AUTH_INTERNAL_URL', '')
    vi.stubEnv('AUTH_ISSUER', 'https://api.klanghaus.dk')
    const event = { path: '/api/auth/sign-in/email?redirect=%2Fdashboard' }
    await handler(event)
    expect(proxyRequestMock).toHaveBeenCalledWith(
      event,
      'https://api.klanghaus.dk/api/auth/sign-in/email?redirect=%2Fdashboard',
    )
  })

  it('prefers AUTH_INTERNAL_URL over AUTH_ISSUER (container-net i Tilt)', async () => {
    vi.stubEnv('AUTH_INTERNAL_URL', 'http://auth:3000')
    vi.stubEnv('AUTH_ISSUER', 'https://api.klanghaus.dk')
    await handler({ path: '/api/auth/get-session' })
    expect(proxyRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      'http://auth:3000/api/auth/get-session',
    )
  })
})
