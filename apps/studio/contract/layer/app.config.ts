import type { OrgNavItem } from '~~/lib/extensions'

// Registers one entry in each of Studio's app.config registries.
export default defineAppConfig({
  studio: {
    orgNav: [
      { id: 'contract', path: 'contract', labelKey: 'contract.nav', gate: 'orgAdmin' },
    ] satisfies OrgNavItem[],
    upgradePath: '/contract-upgrade',
    legalProcessors: ['contractVendor'],
  },
})
