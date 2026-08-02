import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { getPlan, type PlanKey } from '~~/lib/plan-catalog'
import { PORTAL_KEY } from '~~/server/lib/entitlements'
import { lookupOrgBySlug } from '~~/server/lib/org-lookup'
import { orgRoleHelpers, type OrgRole } from '~~/server/lib/project-access'

// §1a-ruling (jura 2026-08-02) + Allans §0 B2B-afskæring: ingen session uden
// aktivt vilkårs-accept-bevis og erhvervs-erklæring — 400, ikke default.
// vatNumber er valgfrit (udenlandske virksomheder uden dansk CVR); VIES-
// valideringen er accounts ansvar bag mintet.
const bodySchema = z.object({
  organizationSlug: z.string().min(1),
  planKey: z.enum(['studio_solo', 'studio_studio', 'studio_scale']),
  businessAttestation: z.literal(true),
  vatNumber: z.string().trim().min(4).max(32).optional(),
  termsAccepted: z.object({
    version: z.string().min(1),
    acceptedAt: z.string().datetime({ offset: true }),
  }),
})

defineRouteMeta({
  openAPI: {
    summary: 'Minter en Stripe Checkout-session via account (S2S-relay).',
    description:
      'Relay til accounts POST /v1/billing/checkout-sessions (kontrakt §5). Studio sender kun plan_key over grænsen — price-ids og Stripe-former bor bag account. 503 når ACCOUNT_URL ikke er konfigureret (dormant indtil accounts endpoint er live).',
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
  if (!getPlan(parsed.data.planKey as PlanKey).purchasable) {
    throw createError({ statusCode: 400, statusMessage: 'Plan is not purchasable' })
  }

  const org = await lookupOrgBySlug(event, parsed.data.organizationSlug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  // Purchases change the org's billing relationship — Sentry-style role model
  // reserves that for owner/billing (not admin/manager, who manage people).
  const role = org.members?.find((m) => m.userId === actor.sub)?.role
  if (!role || !orgRoleHelpers.canManageBilling(role as OrgRole)) {
    throw createError({ statusCode: 403, statusMessage: 'Requires the owner or billing role' })
  }

  const accountUrl = process.env.ACCOUNT_URL
  if (!accountUrl) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Billing is not available yet',
      data: { code: 'billing_unavailable' },
    })
  }

  const appUrl = useRuntimeConfig(event).public.appUrl
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = process.env.ACCOUNT_S2S_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${accountUrl}/v1/billing/checkout-sessions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      tenantOrgId: org.id,
      portalKey: PORTAL_KEY,
      planKey: parsed.data.planKey,
      // §1a: accept-bevis + B2B-attestation følger med mintet (accounts
      // §8-krav — de persisterer version+timestamp); locale=da så Stripes
      // hostede side matcher flowet sprogligt.
      businessAttestation: parsed.data.businessAttestation,
      vatNumber: parsed.data.vatNumber,
      termsAccepted: parsed.data.termsAccepted,
      locale: 'da',
      successUrl: `${appUrl}/orgs/${parsed.data.organizationSlug}?upgrade=success`,
      cancelUrl: `${appUrl}/plans?org=${parsed.data.organizationSlug}&upgrade=cancelled`,
    }),
  })
  if (!res.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not create checkout session',
      data: { code: 'checkout_failed' },
    })
  }

  const { checkoutUrl } = (await res.json()) as { checkoutUrl: string }
  return { checkoutUrl }
})
