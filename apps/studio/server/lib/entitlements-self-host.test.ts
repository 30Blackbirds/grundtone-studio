import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentEntitlementsProvider,
  getStudioEntitlements,
  PROVISIONING_FEATURE,
  setEntitlementsProvider,
  type EntitlementsProvider,
} from './entitlements'
import { SELF_HOST_PLAN_KEY, selfHostProvider } from './entitlements-self-host'

afterEach(() => {
  vi.unstubAllEnvs()
  setEntitlementsProvider(null)
})

describe('selfHostProvider', () => {
  // It always answers: a self-hosted Studio is never refused for lack of one.
  it('answers active, unlimited, with every feature when no limit is configured', async () => {
    vi.stubEnv('STUDIO_LIMIT_BRANDS', '')
    vi.stubEnv('STUDIO_LIMIT_PROJECTS', '')
    expect(await selfHostProvider.get('org-1')).toMatchObject({
      planKey: SELF_HOST_PLAN_KEY,
      planState: 'active',
      features: [PROVISIONING_FEATURE],
      limits: {},
    })
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

  // There is no overage plan to bill the excess to, so a self-host brand
  // limit blocks at the limit.
  it('calls its brand limit a hard cap', () => {
    expect(selfHostProvider.brandLimitIsHardCap?.(null)).toBe(true)
  })
})

describe('provider selection', () => {
  it('uses self-host when no provider is installed, and asks nothing on the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(currentEntitlementsProvider()).toBe(selfHostProvider)
    expect(await getStudioEntitlements('org-1')).toMatchObject({ planKey: SELF_HOST_PLAN_KEY })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('an installed provider wins, and null restores the default', async () => {
    const custom: EntitlementsProvider = { get: vi.fn().mockResolvedValue(null) }
    setEntitlementsProvider(custom)
    expect(currentEntitlementsProvider()).toBe(custom)
    await getStudioEntitlements('org-9')
    expect(custom.get).toHaveBeenCalledWith('org-9')
    setEntitlementsProvider(null)
    expect(currentEntitlementsProvider()).toBe(selfHostProvider)
  })
})
