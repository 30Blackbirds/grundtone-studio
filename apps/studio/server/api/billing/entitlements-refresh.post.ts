import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { clearEntitlementsCacheFor } from '~~/server/lib/entitlements'
import { requireAuthedRequest, requireOrg } from '~~/server/lib/org-request'
import { requireBillingEnabled } from '~~/server/lib/runtime-flags'

const bodySchema = z.object({ organizationSlug: z.string().min(1) })

defineRouteMeta({
  openAPI: {
    summary: 'Busts entitlements-cachen for en org (kaldes på checkout-success).',
    description:
      "Kontrakt §2: Studio refetcher entitlements eksplicit når brugeren lander på checkout-success-URL'en, så opgraderingen føles øjeblikkelig i stedet for at vente på 60s-TTL.",
    tags: ['Billing'],
  },
})

export default defineEventHandler(async (event) => {
  requireBillingEnabled()
  const { actor, data } = requireAuthedRequest(event, bodySchema, await readBody(event))

  // Membership-scoped lookup is the gate; busting a cache is harmless beyond
  // forcing a refetch, so no elevated role is needed.
  const org = await requireOrg(event, actor, data.organizationSlug, 'lookup-only')

  clearEntitlementsCacheFor(org.id)
  return { ok: true }
})
