import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  evaluateProjectQuota,
  getStudioEntitlements,
  clearEntitlementsCache,
  type Entitlements,
} from './entitlements'

function ent(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    planKey: 'studio-free',
    planState: 'active',
    graceUntil: null,
    features: [],
    limits: { 'studio.projects': 2 },
    asOf: new Date().toISOString(),
    ...overrides,
  }
}

describe('evaluateProjectQuota (kontrakt §1 + §4)', () => {
  it('fails open when entitlements are unavailable', () => {
    expect(evaluateProjectQuota(null, 99)).toEqual({ allowed: true })
  })

  it('allows creation under the limit and blocks at the limit', () => {
    expect(evaluateProjectQuota(ent(), 1)).toEqual({ allowed: true })
    expect(evaluateProjectQuota(ent(), 2)).toEqual({
      allowed: false,
      reason: 'quota_exceeded',
      limit: 2,
    })
  })

  it('treats an absent studio.projects key as unlimited (studio-legacy)', () => {
    expect(evaluateProjectQuota(ent({ planKey: 'studio-legacy', limits: {} }), 500)).toEqual({
      allowed: true,
    })
  })

  it('treats limit 0 as a hard zero', () => {
    expect(evaluateProjectQuota(ent({ limits: { 'studio.projects': 0 } }), 0)).toEqual({
      allowed: false,
      reason: 'quota_exceeded',
      limit: 0,
    })
  })

  it('fails closed on suspended regardless of limits', () => {
    expect(evaluateProjectQuota(ent({ planState: 'suspended', limits: {} }), 0)).toEqual({
      allowed: false,
      reason: 'suspended',
    })
  })

  it('treats grace as active until graceUntil, then blocks creation', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(evaluateProjectQuota(ent({ planState: 'grace', graceUntil: future }), 1)).toEqual({
      allowed: true,
    })
    expect(evaluateProjectQuota(ent({ planState: 'grace', graceUntil: past }), 1)).toEqual({
      allowed: false,
      reason: 'suspended',
    })
  })

  it('fails open on canceled (portal-without-default-plan edge, account ruling)', () => {
    expect(evaluateProjectQuota(ent({ planState: 'canceled' }), 2)).toEqual({ allowed: true })
  })
})

describe('getStudioEntitlements (client)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    clearEntitlementsCache()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('is dormant without ACCOUNT_URL (returns null, never fetches)', async () => {
    vi.stubEnv('ACCOUNT_URL', '')
    expect(await getStudioEntitlements('org-1')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches, validates and caches a response', async () => {
    vi.stubEnv('ACCOUNT_URL', 'https://account.test')
    const body = ent()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { etag: 'W/"1"' } }),
    )
    expect(await getStudioEntitlements('org-1')).toEqual(body)
    expect(await getStudioEntitlements('org-1')).toEqual(body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://account.test/v1/entitlements/org-1?portal=grundtone-studio',
    )
  })

  it('returns null on network failure (fail-open) and invalid payloads', async () => {
    vi.stubEnv('ACCOUNT_URL', 'https://account.test')
    fetchMock.mockRejectedValueOnce(new Error('down'))
    expect(await getStudioEntitlements('org-2')).toBeNull()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ nope: true }), { status: 200 }))
    expect(await getStudioEntitlements('org-3')).toBeNull()
  })
})
