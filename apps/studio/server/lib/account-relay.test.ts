import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Relayet var før 16 linjer kopieret mellem checkout og portal, og kun dets
// 503-gren var dækket — gennem endepunkternes tests, og kun fordi de aldrig
// nåede længere. 502-grenen, timeouten og bearer-headeren var aldrig målt.

vi.mock('h3', () => mockH3())

const { requireAccountUrl, postToAccount } = await import('./account-relay')

const FAIL = { statusMessage: 'Could not create portal session', code: 'portal_failed' }

beforeEach(() => {
  delete process.env.ACCOUNT_URL
  delete process.env.ACCOUNT_S2S_TOKEN
})
afterEach(() => {
  vi.unstubAllGlobals()
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
