import { z } from 'zod'
import { clearEntitlementsCacheFor } from '~~/server/lib/entitlements'
import { lookupOrgBySlug } from '~~/server/lib/org-lookup'

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
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  // Membership-scoped lookup is the gate; busting a cache is harmless beyond
  // forcing a refetch, so no elevated role is needed.
  const org = await lookupOrgBySlug(event, parsed.data.organizationSlug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  clearEntitlementsCacheFor(org.id)
  return { ok: true }
})
