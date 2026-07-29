import { describe, it, expect } from 'vitest'
import { PLAN_CATALOG, getPlan } from './plan-catalog'

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
