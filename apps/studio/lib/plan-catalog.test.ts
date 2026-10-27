import { describe, it, expect } from 'vitest'
import da from '../i18n/locales/da.json'
import en from '../i18n/locales/en.json'
import {
  ACCOUNT_PLAN_KEYS,
  PLAN_CATALOG,
  getPlan,
  planForAccountKey,
  planNameKeyForAccountKey,
} from './plan-catalog'

describe('PLAN_CATALOG integrity', () => {
  it('has unique keys in the CMO tier order', () => {
    expect(PLAN_CATALOG.map((p) => p.key)).toEqual([
      'studio_free',
      'studio_solo',
      'studio_studio',
      'studio_scale',
      'studio_enterprise',
    ])
  })

  it('marks exactly the paid self-serve tiers as purchasable', () => {
    expect(PLAN_CATALOG.filter((p) => p.purchasable).map((p) => p.key)).toEqual([
      'studio_solo',
      'studio_studio',
      'studio_scale',
    ])
  })

  it('purchasable plans always carry a price and a brand count', () => {
    for (const plan of PLAN_CATALOG.filter((p) => p.purchasable)) {
      expect(plan.priceEur).toBeGreaterThan(0)
      expect(plan.brandsIncluded).toBeGreaterThan(0)
    }
  })

  it('hard-cap plans have no overage and overage plans no hard cap', () => {
    for (const plan of PLAN_CATALOG) {
      if (plan.hardCap) expect(plan.overageEurPerBrand).toBeNull()
      if (plan.overageEurPerBrand !== null) expect(plan.hardCap).toBe(false)
    }
  })

  it('exactly one plan is highlighted (Mest populær)', () => {
    expect(PLAN_CATALOG.filter((p) => p.highlighted).map((p) => p.key)).toEqual(['studio_studio'])
  })

  it('getPlan resolves every key', () => {
    for (const plan of PLAN_CATALOG) expect(getPlan(plan.key)).toBe(plan)
  })
})

// account owns plan_key and spells it two ways (hyphen for free/legacy/internal,
// underscore for the paid plans). Studio compared it to its own keys directly,
// so `studio-free` matched nothing and lost its hard cap.
describe('plan keys from account', () => {
  it('pins the complete set account returns today ([account] 2026-10-27)', () => {
    // A key account adds later must be added here AND mapped; this list is what
    // makes a missing mapping a red test instead of a silent null.
    expect([...ACCOUNT_PLAN_KEYS].sort()).toEqual(
      [
        'studio-free',
        'studio-internal',
        'studio-legacy',
        'studio_scale',
        'studio_solo',
        'studio_studio',
      ].sort(),
    )
  })

  it("🔴 maps account's hyphenated studio-free to the hard-capped Free plan", () => {
    expect(planForAccountKey('studio-free')).toMatchObject({ key: 'studio_free', hardCap: true })
  })

  it('maps the three paid keys 1:1', () => {
    for (const key of ['studio_solo', 'studio_studio', 'studio_scale'] as const) {
      expect(planForAccountKey(key)?.key).toBe(key)
    }
  })

  it('gives legacy and internal no catalog entry: no cap, no overage rate', () => {
    expect(planForAccountKey('studio-legacy')).toBeNull()
    expect(planForAccountKey('studio-internal')).toBeNull()
  })

  it('does not guess for a key account is not known to return', () => {
    expect(planForAccountKey('studio_free')).toBeNull()
    expect(planForAccountKey('studio-solo')).toBeNull()
    expect(planForAccountKey(undefined)).toBeNull()
    expect(planNameKeyForAccountKey('mystery')).toBeNull()
  })

  it('has a display name in both locales for every key account returns', () => {
    for (const key of ACCOUNT_PLAN_KEYS) {
      const nameKey = planNameKeyForAccountKey(key)
      expect(nameKey, key).not.toBeNull()
      for (const locale of [da, en]) {
        const names = locale.plans.names as Record<string, string>
        expect(names[nameKey!], `${key} → ${nameKey}`).toBeTruthy()
      }
    }
  })
})
