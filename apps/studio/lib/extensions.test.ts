import { describe, expect, it, vi } from 'vitest'
import { type OrgNavItem, legalProcessorKeys, visibleOrgNavItems } from './extensions'
import da from '../i18n/locales/da.json'
import en from '../i18n/locales/en.json'

vi.stubGlobal('defineAppConfig', (config: unknown) => config)
const { default: appConfig } = await import('../app.config')

const billing: OrgNavItem = {
  id: 'billing',
  path: 'billing',
  labelKey: 'billing.nav',
  gate: 'billing',
  feature: 'billing',
}
const reports: OrgNavItem = { id: 'reports', path: 'reports', labelKey: 'r', gate: 'orgAdmin' }

const ctx = (over: Partial<Parameters<typeof visibleOrgNavItems>[1]> = {}) => ({
  canManageBilling: true,
  canManageOrgMembers: true,
  features: { billing: true },
  ...over,
})

describe('org navigation registry', () => {
  it('shows a billing-gated item only to someone who may manage billing', () => {
    expect(visibleOrgNavItems([billing], ctx())).toEqual([billing])
    expect(visibleOrgNavItems([billing], ctx({ canManageBilling: false }))).toEqual([])
  })

  it('shows the billing item to the billing role without org-admin rights', () => {
    expect(visibleOrgNavItems([billing], ctx({ canManageOrgMembers: false }))).toEqual([billing])
  })

  it('hides an item whose feature the deployment has off', () => {
    expect(visibleOrgNavItems([billing], ctx({ features: { billing: false } }))).toEqual([])
  })

  it('gates an orgAdmin item on managing members, not on billing', () => {
    expect(visibleOrgNavItems([reports], ctx({ canManageBilling: false }))).toEqual([reports])
    expect(visibleOrgNavItems([reports], ctx({ canManageOrgMembers: false }))).toEqual([])
  })

  it('lets a later layer replace an item with the same id', () => {
    const replaced = { ...billing, path: 'plan' }
    expect(visibleOrgNavItems([billing, reports, replaced], ctx())).toEqual([reports, replaced])
  })
})

describe('legal processors registry', () => {
  it('lists each key once, in first-registered order', () => {
    expect(legalProcessorKeys(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

// The registered entries are what the sidebar and legal pages render today;
// a missing locale row would show a raw i18n key on a legal page.
describe("Studio's own registrations", () => {
  const studio = appConfig.studio

  it('registers the billing link with its feature and role gate', () => {
    expect(studio.orgNav).toEqual([billing])
  })

  it('keeps the processor list the legal pages showed before the registry', () => {
    expect(studio.legalProcessors).toEqual([
      'upcloud',
      'bunny',
      'stripe',
      'postmark',
      'sentry',
      'proton',
    ])
  })

  it.each([
    ['da', da],
    ['en', en],
  ])('has every registered processor row and nav label in %s', (_, messages) => {
    const rows = (messages as { processors: { rows: Record<string, Record<string, string>> } })
      .processors.rows
    for (const key of studio.legalProcessors) {
      for (const field of ['name', 'service', 'established', 'location', 'transfer']) {
        expect(rows[key]?.[field], `${key}.${field}`).toBeTruthy()
      }
    }
    for (const item of studio.orgNav) {
      const label = item.labelKey
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages)
      expect(label, item.labelKey).toBeTruthy()
    }
  })
})
