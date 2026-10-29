import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Relayet var før 16 linjer kopieret mellem checkout og portal, og kun dets
// 503-gren var dækket — gennem endepunkternes tests, og kun fordi de aldrig
// nåede længere. 502-grenen, timeouten og bearer-headeren var aldrig målt.

vi.mock('h3', () => mockH3())

const { requireAccountUrl, postToAccount } = await import('./account-relay')

const FAIL = { statusMessage: 'Could not create portal session', code: 'portal_failed' }
const originalAccountUrl = process.env.ACCOUNT_URL
const originalAccountS2SToken = process.env.ACCOUNT_S2S_TOKEN

beforeEach(() => {
  delete process.env.ACCOUNT_URL
  delete process.env.ACCOUNT_S2S_TOKEN
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => {
  if (originalAccountUrl === undefined) delete process.env.ACCOUNT_URL
  else process.env.ACCOUNT_URL = originalAccountUrl

  if (originalAccountS2SToken === undefined) delete process.env.ACCOUNT_S2S_TOKEN
  else process.env.ACCOUNT_S2S_TOKEN = originalAccountS2SToken
})

describe('requireAccountUrl', () => {
  it('503er dormant med sin egen fejlkode når ACCOUNT_URL er usat', () => {
    expect(() => requireAccountUrl()).toThrowError(
      expect.objectContaining({ statusCode: 503, data: { code: 'billing_unavailable' } }),
    )
  })

  it('giver URL en igennem når den er sat', () => {
    process.env.ACCOUNT_URL = 'https://account.test'
    expect(requireAccountUrl()).toBe('https://account.test')
  })
})

describe('postToAccount', () => {
  function stubFetch(res: { ok: boolean; json?: () => Promise<unknown> }) {
    const calls: Array<[string, RequestInit]> = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push([url, init])
      return Promise.resolve({ ok: res.ok, json: res.json ?? (() => Promise.resolve({})) })
    })
    return calls
  }

  it('sammensætter URL en af base og sti og sender bodyen som JSON', async () => {
    const calls = stubFetch({ ok: true, json: () => Promise.resolve({ portalUrl: 'https://p' }) })
    const out = await postToAccount<{ portalUrl: string }>(
      'https://account.test',
      '/v1/billing/portal-sessions',
      { tenantOrgId: 'org-1' },
      FAIL,
    )
    expect(out).toEqual({ portalUrl: 'https://p' })
    expect(calls[0][0]).toBe('https://account.test/v1/billing/portal-sessions')
    expect(calls[0][1].method).toBe('POST')
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ tenantOrgId: 'org-1' })
  })

  // 🔴 Ingen Authorization-header når token mangler — IKKE et tomt `Bearer `.
  // Et tomt bearer ligner et autentificerings-forsøg; en manglende header
  // ligner det den er: en manglende konfiguration.
  it('udelader Authorization helt når ACCOUNT_S2S_TOKEN er usat', async () => {
    const calls = stubFetch({ ok: true })
    await postToAccount('https://account.test', '/x', {}, FAIL)
    expect(calls[0][1].headers).toEqual({ 'content-type': 'application/json' })
  })

  it('sætter bearer-headeren når token er sat', async () => {
    process.env.ACCOUNT_S2S_TOKEN = 'hemmelig'
    const calls = stubFetch({ ok: true })
    await postToAccount('https://account.test', '/x', {}, FAIL)
    expect(calls[0][1].headers).toMatchObject({ Authorization: 'Bearer hemmelig' })
  })

  it('sender en abort-signal med, så et hængende account ikke hænger Studio', async () => {
    const calls = stubFetch({ ok: true })
    await postToAccount('https://account.test', '/x', {}, FAIL)
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  // 502 med kalderens EGEN kode: "kaldet fejlede" må ikke forveksles med
  // "billing er ikke konfigureret" (503, billing_unavailable).
  it('502er med kalderens fejlkode når svaret ikke er ok', async () => {
    stubFetch({ ok: false })
    await expect(postToAccount('https://account.test', '/x', {}, FAIL)).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Could not create portal session',
      data: { code: 'portal_failed' },
    })
  })
})

// Condition 2 (a): the mints carry the logged-in user's token next to the S2S
// bearer, and account's 403s on that binding are the user's, not Studio's.
describe('postToAccount — the user token (account#186)', () => {
  const ok = () =>
    vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('{"portalUrl":"u"}')))

  it('sends x-klanghaus-user-token next to the bearer', async () => {
    process.env.ACCOUNT_S2S_TOKEN = 's2s'
    const fetchMock = ok()
    vi.stubGlobal('fetch', fetchMock)
    await postToAccount('https://account.test', '/v1/x', {}, FAIL, 'user-jwt')
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>
    expect(headers['x-klanghaus-user-token']).toBe('user-jwt')
    expect(headers.Authorization).toBe('Bearer s2s')
  })

  it('sends no user-token header when none is given', async () => {
    const fetchMock = ok()
    vi.stubGlobal('fetch', fetchMock)
    await postToAccount('https://account.test', '/v1/x', {}, FAIL)
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>
    expect('x-klanghaus-user-token' in headers).toBe(false)
  })

  it.each(['user_role_insufficient', 'user_org_mismatch'])(
    '🔴 account 403 %s → a 403 carrying that code, not a 502',
    async (code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: code, message: 'm' }), { status: 403 }),
          ),
        ),
      )
      await expect(
        postToAccount('https://account.test', '/v1/x', {}, FAIL, 't'),
      ).rejects.toMatchObject({ statusCode: 403, data: { code } })
    },
  )

  it.each(['invalid_user_token', 'user_token_required'])(
    "account 401 %s is Studio's fault: the caller's 502",
    async (code) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(new Response(JSON.stringify({ error: code }), { status: 401 })),
        ),
      )
      await expect(
        postToAccount('https://account.test', '/v1/x', {}, FAIL, 't'),
      ).rejects.toMatchObject({ statusCode: 502, data: { code: 'portal_failed' } })
    },
  )
})
