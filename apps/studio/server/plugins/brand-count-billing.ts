import { onBrandCountChanged } from '~~/server/lib/brand-hooks'
import { reportBrandCount } from '~~/server/lib/brand-count'

// Wires per-brand billing to the brand-count hook. reportBrandCount answers
// `billing_off` or `dormant` without a network call when billing is not in
// use, so registering it is safe everywhere. This is the one piece that moves
// to the billing overlay together with brand-count.ts.
export default defineNitroPlugin(() => {
  onBrandCountChanged(async (organizationId) => {
    await reportBrandCount(organizationId)
  })
})
