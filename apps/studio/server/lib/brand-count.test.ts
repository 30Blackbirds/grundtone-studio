import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The brand-count report to account (overage billing). The count itself comes
// from brand-quota's countActiveBrands, which the brand-quota suites measure
// against a real Postgres; here it is a stub whose call order we record.

const order: string[] = []
let count = 4
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('./brand-quota', () => ({
  countActiveBrands: () => {
    order.push('count')
    return Promise.resolve(count)
  },
}))

const { classifyBrandCountResponse, reportBrandCount } = await import('./brand-count')

describe('classifyBrandCountResponse', () => {
  it('200 with the count → applied', () => {
    expect(classifyBrandCountResponse(200, { activeBrands: 12, billedExtraBrands: 2 })).toEqual({
      kind: 'applied',
      activeBrands: 12,
      billedExtraBrands: 2,
      previousActiveBrands: null,
    })
    expect(
      classifyBrandCountResponse(200, { activeBrands: 12, previousActiveBrands: 9 }),
    ).toMatchObject({ previousActiveBrands: 9 })
  })

  it("🔴 reads account's error form `{ error }`, not `{ code }`", () => {
    // Measured on account#182: `{"error":"no_subscription","message":"…"}`.
    expect(classifyBrandCountResponse(404, { code: 'no_subscription' })).toMatchObject({
      kind: 'failed',
    })
  })

  it('409 stale → stale (a newer reading is already applied)', () => {
    expect(classifyBrandCountResponse(409, { error: 'stale' })).toEqual({ kind: 'stale' })
  })

  it('404 no_subscription → nothing to bill', () => {
    expect(classifyBrandCountResponse(404, { error: 'no_subscription' })).toEqual({
      kind: 'no_subscription',
    })
  })

  it('🔴 a 404 WITHOUT account\'s code is a failure, not "nothing to bill"', () => {
    // An account that does not serve the route yet answers a bare 404.
    expect(classifyBrandCountResponse(404, null)).toMatchObject({ kind: 'failed' })
    expect(classifyBrandCountResponse(404, { error: 'not_found' })).toMatchObject({
      kind: 'failed',
    })
  })

  it('422 over_cap and 5xx are failures', () => {
    expect(classifyBrandCountResponse(422, { error: 'over_cap' })).toMatchObject({ kind: 'failed' })
    expect(classifyBrandCountResponse(503, null)).toMatchObject({ kind: 'failed' })
  })

  it('a 200 without a count is not an applied report', () => {
    expect(classifyBrandCountResponse(200, {})).toMatchObject({ kind: 'failed' })
  })
})

describe('reportBrandCount', () => {
  const calls: Array<{ url: string; init: RequestInit }> = []

  beforeEach(() => {
    order.length = 0
    calls.length = 0
    count = 4
    process.env.ACCOUNT_URL = 'http://account.test'
    process.env.ACCOUNT_S2S_TOKEN = 's2s'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        order.push('fetch')
        calls.push({ url, init })
        return Promise.resolve(
          new Response(JSON.stringify({ activeBrands: count, billedExtraBrands: 0 })),
        )
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.ACCOUNT_URL
    delete process.env.ACCOUNT_S2S_TOKEN
  })

  it('PUTs the count with portal, asOf and the S2S bearer', async () => {
    const before = Date.now()
    await expect(reportBrandCount('org/1')).resolves.toMatchObject({
      kind: 'applied',
      activeBrands: 4,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://account.test/v1/billing/org%2F1/brand-count')
    expect(calls[0]!.init.method).toBe('PUT')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer s2s')
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ portalKey: 'grundtone-studio', activeBrands: 4 })
    expect(new Date(body.asOf as string).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('reads the count before it sends', async () => {
    await reportBrandCount('org-1')
    expect(order).toEqual(['count', 'fetch'])
  })

  // Checked before ACCOUNT_URL: here the URL is set, and still nothing goes out.
  it('with FEATURE_BILLING=off: no count, no call, even with ACCOUNT_URL set', async () => {
    process.env.FEATURE_BILLING = 'off'
    try {
      await expect(reportBrandCount('org-1')).resolves.toEqual({ kind: 'billing_off' })
      expect(order).toEqual([])
    } finally {
      process.env.FEATURE_BILLING = 'on'
    }
  })

  it('is dormant without ACCOUNT_URL: no count, no call', async () => {
    delete process.env.ACCOUNT_URL
    await expect(reportBrandCount('org-1')).resolves.toEqual({ kind: 'dormant' })
    expect(order).toEqual([])
  })

  it('🔴 never throws: a transport error becomes a logged failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )
    await expect(reportBrandCount('org-1')).resolves.toMatchObject({ kind: 'failed' })
    expect(console.error).toHaveBeenCalled()
  })
})
