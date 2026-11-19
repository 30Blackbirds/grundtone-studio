import { onBrandCountChanged } from '~~/server/lib/brand-hooks'
import {
  PROVISIONING_FEATURE,
  setEntitlementsProvider,
  type EntitlementsProvider,
} from '~~/server/lib/entitlements'
import { registerFeature } from '~~/server/lib/features'
import { onOrgServed } from '~~/server/lib/org-hooks'
import { parseRuntimeFlag } from '~~/server/lib/runtime-flags'

// Uses each server-side extension point the way a real layer does. What the
// listeners hear is kept here and reported by GET /api/_contract.

export const heard = { brandCount: [] as string[], orgServed: [] as string[] }

export const contractProvider: EntitlementsProvider = {
  async get() {
    return {
      planKey: 'contract-plan',
      planState: 'active',
      graceUntil: null,
      features: [PROVISIONING_FEATURE],
      limits: { 'studio.projects': 7 },
      asOf: new Date(0).toISOString(),
    }
  },
  brandLimitIsHardCap: () => false,
}

export default defineNitroPlugin(() => {
  // A layer's own required switch, with Studio's rule and message.
  parseRuntimeFlag('CONTRACT_FLAG', process.env.CONTRACT_FLAG, ['on'], 'set by the contract job.')
  setEntitlementsProvider(contractProvider)
  registerFeature('billing', () => true)
  onBrandCountChanged((organizationId) => {
    heard.brandCount.push(organizationId)
  })
  onOrgServed((org) => {
    heard.orgServed.push(org.id)
  })
})
