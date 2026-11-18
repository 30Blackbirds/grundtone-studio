import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountProvider,
  clearEntitlementsCache,
  currentEntitlementsProvider,
  getStudioEntitlements,
  setEntitlementsProvider,
  type EntitlementsProvider,
} from './entitlements'
import { SELF_HOST_PLAN_KEY, selfHostProvider } from './entitlements-self-host'

afterEach(() => {
  vi.unstubAllEnvs()
  setEntitlementsProvider(null)
  clearEntitlementsCache()
})

describe('selfHostProvider', () => {
  it('answers null when no limit is configured (unlimited)', async () => {
    vi.stubEnv('STUDIO_LIMIT_BRANDS', '')
    vi.stubEnv('STUDIO_LIMIT_PROJECTS', '')
    expect(await selfHostProvider.get('org-1')).toBeNull()
  })

  it('reports only the limits that are set, so an unset one stays unlimited', async () => {
    vi.stubEnv('STUDIO_LIMIT_BRANDS', '5')
    vi.stubEnv('STUDIO_LIMIT_PROJECTS', '')
    const e = await selfHostProvider.get('org-1')
    expect(e).toMatchObject({ planKey: SELF_HOST_PLAN_KEY, planState: 'active' })
    expect(e?.limits).toEqual({ 'studio.brands': 5 })
  })

  it('treats 0 as a hard zero, like the account contract', async () => {
    vi.stubEnv('STUDIO_LIMIT_PROJECTS', '0')
    expect((await selfHostProvider.get('org-1'))?.limits).toEqual({ 'studio.projects': 0 })
  })

  it('rejects a malformed limit instead of silently lifting the cap', async () => {
    vi.stubEnv('STUDIO_LIMIT_BRANDS', 'ten')
    await expect(selfHostProvider.get('org-1')).rejects.toThrow('STUDIO_LIMIT_BRANDS')
  })
})

describe('provider selection', () => {
  it('uses self-host with billing off and never asks account', async () => {
    vi.stubEnv('FEATURE_BILLING', 'off')
    vi.stubEnv('ACCOUNT_URL', 'https://account.test')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(currentEntitlementsProvider()).toBe(selfHostProvider)
    expect(await getStudioEntitlements('org-1')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('uses the account provider with billing on', () => {
    vi.stubEnv('FEATURE_BILLING', 'on')
    expect(currentEntitlementsProvider()).toBe(accountProvider)
  })

  it('an installed provider wins over both, and null restores the default', async () => {
    const custom: EntitlementsProvider = { get: vi.fn().mockResolvedValue(null) }
    vi.stubEnv('FEATURE_BILLING', 'on')
    setEntitlementsProvider(custom)
    expect(currentEntitlementsProvider()).toBe(custom)
    await getStudioEntitlements('org-9')
    expect(custom.get).toHaveBeenCalledWith('org-9')
    setEntitlementsProvider(null)
    expect(currentEntitlementsProvider()).toBe(accountProvider)
  })
})
