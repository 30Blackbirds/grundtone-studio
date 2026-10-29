import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// The account user token (condition 2 (a)): the request to auth#194's
// `POST /api/auth/account-user-token`, and how each answer reaches the user.
// The codes are auth's, measured on auth#194 with enforceOriginCheck=true.

vi.mock('h3', () => mockH3())
vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: 'https://studio.test/some/path' } }))

const { classifyUserTokenResponse, mintAccountUserToken: mint } =
  await import('./account-user-token')
const mintAccountUserToken = (event: FakeEvent, orgId: string) =>
  mint(event as unknown as H3Event, orgId)

describe('classifyUserTokenResponse (auth#194 answers)', () => {
  it('200 with a token → the token', () => {
    expect(
      classifyUserTokenResponse(200, { token: 'jwt', tokenType: 'Bearer', expiresIn: 300 }),
    ).toEqual({ kind: 'token', token: 'jwt' })
  })

  it('401 → 401 session_expired', () => {
    expect(classifyUserTokenResponse(401, { code: 'UNAUTHORIZED' })).toMatchObject({
      error: { statusCode: 401, data: { code: 'session_expired' } },
    })
  })

  it("403 not a member → 403 not_a_member, the user's own problem", () => {
    expect(
      classifyUserTokenResponse(403, { code: 'ACCOUNT_USER_TOKEN_NOT_A_MEMBER' }),
    ).toMatchObject({ error: { statusCode: 403, data: { code: 'not_a_member' } } })
  })

  it.each(['MISSING_OR_NULL_ORIGIN', 'INVALID_ORIGIN'])(
    '🔴 403 %s is OUR configuration: 502, never shown as "no access"',
    (code) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(classifyUserTokenResponse(403, { code })).toMatchObject({
        error: { statusCode: 502, data: { code: 'user_token_unavailable' } },
      })
      expect(error.mock.calls[0]![0]).toContain('trustedOrigins')
      error.mockRestore()
    },
  )

  it('a 200 without a token is not a token', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(classifyUserTokenResponse(200, {})).toMatchObject({ error: { statusCode: 502 } })
  })

  it('400 VALIDATION_ERROR → 502 (Studio sent a bad body)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(classifyUserTokenResponse(400, { code: 'VALIDATION_ERROR' })).toMatchObject({
      error: { statusCode: 502 },
    })
  })
})

describe('mintAccountUserToken', () => {
  const calls: Array<{ url: string; init: RequestInit }> = []

  beforeEach(() => {
    calls.length = 0
    process.env.AUTH_INTERNAL_URL = 'http://auth.internal:3000'
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, init })
        return Promise.resolve(new Response(JSON.stringify({ token: 'jwt-1', expiresIn: 300 })))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { appUrl: 'https://studio.test/some/path' },
    }))
    vi.restoreAllMocks()
    delete process.env.AUTH_INTERNAL_URL
  })

  const withCookie = () =>
    fakeEvent({ headers: { cookie: 'better-auth.session_token=abc; other=1' } })

  it("POSTs { orgId } to auth with the raw Cookie header and Studio's origin", async () => {
    await expect(mintAccountUserToken(withCookie(), 'org-1')).resolves.toBe('jwt-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://auth.internal:3000/api/auth/account-user-token')
    expect(calls[0]!.init.method).toBe('POST')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.cookie).toBe('better-auth.session_token=abc; other=1')
    // 🔴 A server-side fetch sends no Origin; auth refuses a cookie POST without one.
    expect(headers.origin).toBe('https://studio.test')
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ orgId: 'org-1' })
  })

  it('401s without calling auth when the request has no cookie', async () => {
    await expect(mintAccountUserToken(fakeEvent({}), 'org-1')).rejects.toMatchObject({
      statusCode: 401,
      data: { code: 'session_expired' },
    })
    expect(calls).toHaveLength(0)
  })

  it('an unreachable auth is a 502, not a hang or a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )
    await expect(mintAccountUserToken(withCookie(), 'org-1')).rejects.toMatchObject({
      statusCode: 502,
      data: { code: 'user_token_unavailable' },
    })
  })
})
