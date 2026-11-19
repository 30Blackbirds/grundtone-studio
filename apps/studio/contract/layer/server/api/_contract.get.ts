import { notifyBrandCountChanged } from '~~/server/lib/brand-hooks'
import { currentEntitlementsProvider, getStudioEntitlements } from '~~/server/lib/entitlements'
import { notifyOrgServed } from '~~/server/lib/org-hooks'
import { contractProvider, heard } from '../plugins/contract'

// Reports, from inside the running server, what the fixture's registrations
// changed. contract/check.mjs decides whether that is what Studio promises.
export default defineEventHandler(async () => {
  notifyBrandCountChanged('contract-org')
  notifyOrgServed({ id: 'contract-org', slug: 'contract' })
  // Listeners are not awaited by the caller; give them one turn.
  await new Promise((resolve) => setTimeout(resolve, 0))

  const entitlements = await getStudioEntitlements('contract-org')
  const task = await runTask('contract:ping')
  return {
    providerInstalled: currentEntitlementsProvider() === contractProvider,
    entitlementsPlanKey: entitlements?.planKey ?? null,
    heard,
    task: task.result,
    appConfig: useAppConfig().studio,
  }
})
