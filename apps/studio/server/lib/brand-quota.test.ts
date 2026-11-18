import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('h3', () => ({
  createError: (opts: Record<string, unknown>) =>
    Object.assign(new Error(String(opts.statusMessage)), opts),
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown) => ({ op: 'inArray', col, vals }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    text: strings.join('?'),
    values,
  }),
}))

const state = { alreadyActive: false, activeBrands: 0, countCalls: 0 }
// Every query the helper makes, in order, so the claim cells can pin that the
// lock comes before the re-check, the count and the insert.
const log: string[] = []
const inserted: unknown[] = []

// One fake serves as both `db` and a transaction: the helper issues the same
// select/$count queries through either.
const fakeQueries = {
  execute: (query: { values: unknown[] }) => {
    log.push(`lock:${String(query.values[0])}`)
    return Promise.resolve([])
  },
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          log.push('isActive')
          return Promise.resolve(state.alreadyActive ? [{ projectId: 'p-new' }] : [])
        },
      }),
    }),
  }),
  $count: () => {
    log.push('count')
    state.countCalls += 1
    return Promise.resolve(state.activeBrands)
  },
  insert: () => ({
    values: (row: unknown) => {
      log.push('insert')
      inserted.push(row)
      return Promise.resolve()
    },
  }),
}
vi.mock('~~/server/db', () => ({ db: fakeQueries }))
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

const { assertBrandCapacity, claimBrandSlot } = await import('./brand-quota')

type Entitlements = import('./entitlements').Entitlements
const ent = (
  planKey: string,
  brands: number | undefined,
  planState: Entitlements['planState'] = 'active',
): Entitlements => ({
  planKey,
  planState,
  graceUntil: null,
  features: [],
  limits: brands === undefined ? {} : { 'studio.brands': brands },
  asOf: '2026-09-15T00:00:00.000Z',
})

const ROW = {
  projectId: 'p-new',
  configVersionId: 'v-1',
  activatedBy: 'user-1',
  activatedByEmail: 'user@example.test',
}
const tx = fakeQueries as unknown as Parameters<typeof claimBrandSlot>[0]

const savedAccountUrl = process.env.ACCOUNT_URL
beforeEach(() => {
  state.alreadyActive = false
  state.activeBrands = 0
  state.countCalls = 0
  log.length = 0
  inserted.length = 0
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
  it('returns null for a project that already has an active version, even at the cap (republish/rollback)', async () => {
    state.alreadyActive = true
    state.activeBrands = 3
    getStudioEntitlements.mockResolvedValue(ent('studio_solo', 3))
    await expect(assertBrandCapacity('org-1', 'p-1')).resolves.toBeNull()
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

  it('enforces a self-host brand limit as a hard cap (no catalog plan, no overage to bill)', async () => {
    state.activeBrands = 5
    getStudioEntitlements.mockResolvedValue(ent('self-host', 5))
    await expect(assertBrandCapacity('org-1', 'p-new')).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'brand_quota_exceeded', limit: 5, planKey: 'self-host' },
    })
  })

  // account returns the free plan as `studio-free` (hyphen). Studio once
  // compared that to its own `studio_free` and found no hard cap.
  it('🔴 refuses the 3rd brand on Free when account spells it studio-free', async () => {
    state.activeBrands = 2
    getStudioEntitlements.mockResolvedValue(ent('studio-free', 2))
    await expect(assertBrandCapacity('org-1', 'p-new')).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'brand_quota_exceeded', limit: 2, planKey: 'studio-free' },
    })
  })

  it('allows the 3rd brand on Solo and hands back the claim context (positive control)', async () => {
    state.activeBrands = 2
    getStudioEntitlements.mockResolvedValue(ent('studio_solo', 3))
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toEqual({
      organizationId: 'org-1',
      entitlements: ent('studio_solo', 3),
      hardCap: true,
    })
    expect(recordQuotaDenial).not.toHaveBeenCalled()
  })

  it('allows the 11th brand on Studio, which bills overage instead of blocking', async () => {
    state.activeBrands = 10
    getStudioEntitlements.mockResolvedValue(ent('studio_studio', 10))
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toMatchObject({ hardCap: false })
    expect(state.countCalls).toBe(0)
  })

  it('fails open and counts it when entitlements are unavailable', async () => {
    process.env.ACCOUNT_URL = 'http://account.test'
    state.activeBrands = 99
    getStudioEntitlements.mockResolvedValue(null)
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toEqual({
      organizationId: 'org-1',
      entitlements: null,
      hardCap: false,
    })
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
    await expect(assertBrandCapacity('org-1', 'p-new')).resolves.toMatchObject({ hardCap: false })
  })
})

// The locking itself is only observable against a real database; these cells
// pin the ORDER of the queries, and brand-quota.race.test.ts pins that the
// order actually serialises concurrent claims.
describe('claimBrandSlot', () => {
  const soloClaim = { organizationId: 'org-1', entitlements: ent('studio_solo', 3), hardCap: true }

  it('takes the organization lock before it re-checks, counts and inserts', async () => {
    state.activeBrands = 2
    await expect(claimBrandSlot(tx, soloClaim, ROW)).resolves.toBeUndefined()
    expect(log).toEqual(['lock:studio.brands:org-1', 'isActive', 'count', 'insert'])
    expect(inserted).toEqual([ROW])
  })

  it('refuses under the lock when another first activation took the last slot, inserting nothing', async () => {
    state.activeBrands = 3
    await expect(claimBrandSlot(tx, soloClaim, ROW)).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'brand_quota_exceeded', limit: 3, planKey: 'studio_solo' },
    })
    expect(log).toEqual(['lock:studio.brands:org-1', 'isActive', 'count'])
    expect(inserted).toEqual([])
    expect(recordQuotaDenial).toHaveBeenCalledWith('studio.brands')
  })

  it('returns without counting when the project became a brand while it waited for the lock', async () => {
    state.alreadyActive = true
    state.activeBrands = 3
    await expect(claimBrandSlot(tx, soloClaim, ROW)).resolves.toBeUndefined()
    expect(log).toEqual(['lock:studio.brands:org-1', 'isActive'])
    expect(inserted).toEqual([])
  })

  it('creates the brand without counting on a plan that bills overage', async () => {
    state.activeBrands = 10
    const studioClaim = {
      organizationId: 'org-1',
      entitlements: ent('studio_studio', 10),
      hardCap: false,
    }
    await expect(claimBrandSlot(tx, studioClaim, ROW)).resolves.toBeUndefined()
    expect(log).toEqual(['lock:studio.brands:org-1', 'isActive', 'insert'])
  })
})
