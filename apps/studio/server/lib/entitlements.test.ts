import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  evaluateProjectQuota,
  getStudioEntitlements,
  setEntitlementsProvider,
  type Entitlements,
  evaluateBrandQuota,
  evaluateProvisioningFeature,
  requireProvisioningFeature,
  PROVISIONING_FEATURE,
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

describe('evaluateBrandQuota (riff bfxmm7xktk6xkfanh5eennva)', () => {
  const solo = (over: Record<string, unknown> = {}) =>
    ent({ planKey: 'studio_solo', limits: { 'studio.brands': 3 }, ...over })

  it('blocks a hard-cap plan at the limit and allows below it', () => {
    expect(evaluateBrandQuota(solo(), 2, true)).toEqual({ allowed: true })
    expect(evaluateBrandQuota(solo(), 3, true)).toEqual({
      allowed: false,
      reason: 'brand_quota_exceeded',
      limit: 3,
    })
  })

  it('never blocks a plan with overage, even over its included brands (control)', () => {
    const studio = ent({ planKey: 'studio_studio', limits: { 'studio.brands': 10 } })
    expect(evaluateBrandQuota(studio, 10, false)).toEqual({ allowed: true })
    expect(evaluateBrandQuota(studio, 25, false)).toEqual({ allowed: true })
  })

  it('treats an absent studio.brands key as unlimited on a hard-cap plan', () => {
    expect(evaluateBrandQuota(solo({ limits: {} }), 99, true)).toEqual({ allowed: true })
  })

  it('fails open when entitlements are unavailable', () => {
    expect(evaluateBrandQuota(null, 99, true)).toEqual({ allowed: true })
  })

  it('blocks suspended and expired grace regardless of hard cap', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(evaluateBrandQuota(solo({ planState: 'suspended' }), 0, false)).toEqual({
      allowed: false,
      reason: 'suspended',
    })
    expect(evaluateBrandQuota(solo({ planState: 'grace', graceUntil: past }), 0, true)).toEqual({
      allowed: false,
      reason: 'suspended',
    })
  })

  it('stays open on canceled (same account ruling as the project quota)', () => {
    expect(evaluateBrandQuota(solo({ planState: 'canceled' }), 3, true)).toEqual({ allowed: true })
  })
})

describe('🔴 evaluateProvisioningFeature — a PAID bool feature fails CLOSED (KH-964 AC-E, §4)', () => {
  const paid = (o: Partial<Entitlements> = {}) =>
    ent({ planKey: 'studio_solo', features: [PROVISIONING_FEATURE], limits: {}, ...o })

  it('matches the key account seeds on its paid and internal plans', () => {
    // A typo here would refuse every paying org with feature_not_enabled, and
    // every cell below would still pass — they all build on this constant.
    expect(PROVISIONING_FEATURE).toBe('studio.provisioning_api')
  })

  it('ACCEPT: a paid plan carrying the feature', () => {
    expect(evaluateProvisioningFeature(paid())).toEqual({ allowed: true })
  })

  it('ACCEPT (AC-E5): the internal plan — the feature, and no limits at all', () => {
    expect(evaluateProvisioningFeature(paid({ planKey: 'studio-internal' }))).toEqual({
      allowed: true,
    })
  })

  it('ACCEPT: grace before graceUntil is active (§4)', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(evaluateProvisioningFeature(paid({ planState: 'grace', graceUntil: future }))).toEqual({
      allowed: true,
    })
  })

  it('AC-E1: studio-free → 403 feature_not_enabled', () => {
    expect(evaluateProvisioningFeature(ent())).toEqual({
      allowed: false,
      status: 403,
      code: 'feature_not_enabled',
    })
  })

  it('AC-E1: studio-legacy (unlimited quotas, no paid features) → feature_not_enabled', () => {
    expect(
      evaluateProvisioningFeature(ent({ planKey: 'studio-legacy', limits: {} })),
    ).toMatchObject({
      code: 'feature_not_enabled',
    })
  })

  it('🔴 AC-E2: no answer → 503 entitlements_unavailable, NOT allowed — the opposite of the quotas', () => {
    // The same `null` that evaluateProjectQuota turns into { allowed: true }.
    expect(evaluateProjectQuota(null, 99)).toEqual({ allowed: true })
    expect(evaluateProvisioningFeature(null)).toEqual({
      allowed: false,
      status: 503,
      code: 'entitlements_unavailable',
    })
  })

  it.each([
    ['suspended', {}],
    [
      'expired grace',
      { planState: 'grace' as const, graceUntil: new Date(Date.now() - 60_000).toISOString() },
    ],
    ['canceled', { planState: 'canceled' as const }],
  ])('AC-E3: %s with the feature → 403 suspended, not "upgrade"', (_label, o) => {
    const e = paid({ planState: 'suspended', ...o })
    expect(evaluateProvisioningFeature(e)).toEqual({
      allowed: false,
      status: 403,
      code: 'suspended',
    })
  })

  it('AC-E3: suspended WITHOUT the feature still hears suspended', () => {
    expect(evaluateProvisioningFeature(ent({ planState: 'suspended' }))).toMatchObject({
      code: 'suspended',
    })
  })
})

// requireProvisioningFeature against the provider in force. The account
// client's own cells live with it in the billing layer; these use a stand-in
// provider so the gate's fail-closed rule is pinned here, where it lives.
describe('requireProvisioningFeature — the provider in force', () => {
  afterEach(() => {
    setEntitlementsProvider(null)
    vi.restoreAllMocks()
  })

  const install = (answer: Entitlements | null) =>
    setEntitlementsProvider({ get: () => Promise.resolve(answer) })

  // D-E2: a self-hosted Studio has every feature, with no provider installed.
  it('the default (self-host) provider allows it', async () => {
    await expect(requireProvisioningFeature('org-any')).resolves.toBeUndefined()
    expect((await getStudioEntitlements('org-any'))?.features).toContain(PROVISIONING_FEATURE)
  })

  it('ACCEPT: an installed provider that grants the feature', async () => {
    install(ent({ features: [PROVISIONING_FEATURE] }))
    await expect(requireProvisioningFeature('org-ok')).resolves.toBeUndefined()
  })

  it('🔴 AC-E2: an installed provider that cannot answer → 503, not allowed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    install(null)
    await expect(requireProvisioningFeature('org-down')).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'entitlements_unavailable' },
    })
  })

  it('AC-E1: a plan without the feature → 403 feature_not_enabled', async () => {
    install(ent())
    await expect(requireProvisioningFeature('org-free')).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'feature_not_enabled' },
    })
  })
})
