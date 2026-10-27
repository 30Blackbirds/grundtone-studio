import { orgsWithBrands, reportBrandCount } from '~~/server/lib/brand-count'

// Scheduled daily in nuxt.config.ts. Re-sends every org's active-brand count
// to account, so a report lost at publish time (account down, a timeout) is
// billed correctly within a day. Account answers 404 no_subscription for orgs
// it does not bill; those are counted, not errors. Every count it CHANGES is
// logged (org, old → new) and counted as `changed`; the old value is the
// `previousActiveBrands` account returns on 200.
export default defineTask({
  meta: {
    name: 'billing:brand-count-reconcile',
    description: 'Re-send each org’s active-brand count to account (overage billing)',
  },
  async run() {
    const tally: Record<string, number> = {}
    for (const orgId of await orgsWithBrands()) {
      const outcome = await reportBrandCount(orgId)
      tally[outcome.kind] = (tally[outcome.kind] ?? 0) + 1
      // 🔴 [sikkerhed] on account#182: a healer that changes a billed count
      // must say so. A silent repair turns a lost or raced report into a cost
      // nobody sees. One line per change, plus the count in the tally.
      if (
        outcome.kind === 'applied' &&
        outcome.previousActiveBrands !== null &&
        outcome.previousActiveBrands !== outcome.activeBrands
      ) {
        tally.changed = (tally.changed ?? 0) + 1
        console.warn(
          `[brand-count-reconcile] org ${orgId}: billed count ${outcome.previousActiveBrands} → ${outcome.activeBrands}`,
        )
      }
    }
    console.info('[brand-count-reconcile]', JSON.stringify(tally))
    return { result: tally }
  },
})
