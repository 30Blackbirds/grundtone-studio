import { orgsWithBrands, reportBrandCount } from '~~/server/lib/brand-count'

// Scheduled daily in nuxt.config.ts. Re-sends every org's active-brand count
// to account, so a report lost at publish time (account down, a timeout) is
// billed correctly within a day. Account answers 404 no_subscription for orgs
// it does not bill; those are counted, not errors.
export default defineTask({
  meta: {
    name: 'billing:brand-count-reconcile',
    description: 'Re-send each org’s active-brand count to account (overage billing)',
  },
  async run() {
    const tally: Record<string, number> = {}
    for (const orgId of await orgsWithBrands()) {
      const { kind } = await reportBrandCount(orgId)
      tally[kind] = (tally[kind] ?? 0) + 1
    }
    console.info('[brand-count-reconcile]', JSON.stringify(tally))
    return { result: tally }
  },
})
