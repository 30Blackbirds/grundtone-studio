import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  createError: (opts: Record<string, unknown>) =>
    Object.assign(new Error(String(opts.statusMessage)), opts),
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown) => ({ op: 'inArray', col, vals }),
}))

const state = { alreadyActive: false, activeBrands: 0, countCalls: 0 }
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.alreadyActive ? [{ projectId: 'p-1' }] : []),
        }),
      }),
    }),
    $count: () => {
      state.countCalls += 1
      return Promise.resolve(state.activeBrands)
    },
  },
}))
vi.mock('~~/server/db/schema', () => ({
  activeVersion: { projectId: 'active_version.project_id' },
  project: { id: 'project.id', organizationId: 'project.organization_id' },
}))

const getStudioEntitlements = vi.fn()
vi.mock('~~/server/lib/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./entitlements')>()
  return { ...actual, getStudioEntitlements: (...a: unknown[]) => getStudioEntitlements(...a) }
})
const recordQuotaDenial = vi.fn()
const recordQuotaFailOpen = vi.fn()
vi.mock('~~/server/lib/metrics', () => ({
  recordQuotaDenial: (...a: unknown[]) => recordQuotaDenial(...a),
  recordQuotaFailOpen: (...a: unknown[]) => recordQuotaFailOpen(...a),
}))

const { assertBrandCapacity } = await import('./brand-quota')

const ent = (planKey: string, brands: number | undefined, planState = 'active') => ({
  planKey,
  planState,
  graceUntil: null,
  limits: brands === undefined ? {} : { 'studio.brands': brands },
})

const savedAccountUrl = process.env.ACCOUNT_URL
beforeEach(() => {
  state.alreadyActive = false
  state.activeBrands = 0
  state.countCalls = 0
  getStudioEntitlements.mockReset()
  recordQuotaDenial.mockReset()
  recordQuotaFailOpen.mockReset()
  delete process.env.ACCOUNT_URL
})
afterEach(() => {
  if (savedAccountUrl === undefined) delete process.env.ACCOUNT_URL
  else process.env.ACCOUNT_URL = savedAccountUrl
})

describe('assertBrandCapacity', () => {
  it('allows a project that already has an active version, even at the cap (republish/rollback)', async () => {
    state.alreadyActive = true
    state.activeBrands = 3
    getStudioEntitlements.mockResolvedValue(ent('studio_solo', 3))
    await expect(assertBrandCapacity('org-1', 'p-1')).resolves.toBeUndefined()
    expect(getStudioEntitlements).not.toHaveBeenCalled()
  })

  it('refuses the 4th brand on Solo with a distinguishable code', async () => {
    state.activeBrands = 3
    getStudioEntitlements.mockResolvedValue(ent('studio_solo', 3))
    await expect(assertBrandCapacity('org-1', 'p-new')).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'brand_quota_exceeded', limit: 3, planKey: 'studio_solo' },
    })
    expect(recordQuotaDenial).toHaveBeenCalledWith('studio.brands')
  })

  it('allows the 3rd brand on Solo (positive control)', async () => {
    state.activeBrands = 2
    getStudioEntitlements.mockResolvedValue(ent('studio_solo', 3))
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toBeUndefined()
    expect(recordQuotaDenial).not.toHaveBeenCalled()
  })

  it('allows the 11th brand on Studio, which bills overage instead of blocking', async () => {
    state.activeBrands = 10
    getStudioEntitlements.mockResolvedValue(ent('studio_studio', 10))
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toBeUndefined()
    expect(state.countCalls).toBe(0)
  })

  it('fails open and counts it when entitlements are unavailable', async () => {
    process.env.ACCOUNT_URL = 'http://account.test'
    state.activeBrands = 99
    getStudioEntitlements.mockResolvedValue(null)
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toBeUndefined()
    expect(recordQuotaFailOpen).toHaveBeenCalledWith('studio.brands', 'entitlements_unavailable')
  })

  it('refuses a new brand for a suspended org, even on a plan with overage', async () => {
    getStudioEntitlements.mockResolvedValue(ent('studio_studio', 10, 'suspended'))
    await expect(assertBrandCapacity('org-1', 'p-new')).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'suspended' },
    })
    expect(recordQuotaDenial).not.toHaveBeenCalled()
  })

  it('does not block a plan key the catalog does not know (declared fail-open)', async () => {
    state.activeBrands = 50
    getStudioEntitlements.mockResolvedValue(ent('studio-legacy', 3))
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toBeUndefined()
  })
})
