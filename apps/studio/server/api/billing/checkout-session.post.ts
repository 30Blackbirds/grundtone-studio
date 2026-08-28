import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { getPlan, type PlanKey } from '~~/lib/plan-catalog'
import { PORTAL_KEY } from '~~/server/lib/entitlements'
import { requireAuthedRequest, requireOrg } from '~~/server/lib/org-request'

// §1a-ruling (jura 2026-08-02) + Allans §0 B2B-afskæring: ingen session uden
// aktivt vilkårs-accept-bevis og erhvervs-erklæring — 400, ikke default.
// vatNumber er valgfrit (udenlandske virksomheder uden dansk CVR); VIES-
// valideringen er accounts ansvar bag mintet.
const acceptProof = z.object({
  version: z.string().min(1),
  acceptedAt: z.string().datetime({ offset: true }),
})

const bodySchema = z.object({
  organizationSlug: z.string().min(1),
  planKey: z.enum(['studio_solo', 'studio_studio', 'studio_scale']),
  // Two legal effects, two proof trails (jura §0 krav 1+3) — the attestation
  // carries its own version+timestamp exactly like the terms accept.
  businessAttestation: acceptProof,
  // §8c-ruling (account/Allan): REQUIRED — CVR (DK), momsnummer (EU) eller
  // virksomheds-id (øvrige); account 400'er også uden. Format-/VIES-validering
  // er accounts side af mintet.
  vatNumber: z.string().trim().min(4).max(32),
  termsAccepted: acceptProof,
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
  const { actor, data } = requireAuthedRequest(event, bodySchema, await readBody(event))
  // Bliver stående FØR org-opslaget: flyttet bagom ville en ukendt org med en
  // ikke-købbar plan svare 404 i stedet for 400.
  if (!getPlan(data.planKey as PlanKey).purchasable) {
    throw createError({ statusCode: 400, statusMessage: 'Plan is not purchasable' })
  }

  // Purchases change the org's billing relationship — Sentry-style role model
  // reserves that for owner/billing (not admin/manager, who manage people).
  const org = await requireOrg(event, actor, data.organizationSlug, 'billing')

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
      planKey: data.planKey,
      // §1a: accept-bevis + B2B-attestation følger med mintet (accounts
      // §8-krav — de persisterer version+timestamp); locale=da så Stripes
      // hostede side matcher flowet sprogligt.
      // Flad feltform jf. §8c (account adopterede vores form 1:1); de sætter
      // tax-id'et på Stripe-customeren (VIES + reverse charge bag mintet).
      businessAttestation: data.businessAttestation,
      vatNumber: data.vatNumber,
      termsAccepted: data.termsAccepted,
      locale: 'da',
      successUrl: `${appUrl}/orgs/${data.organizationSlug}?upgrade=success`,
      cancelUrl: `${appUrl}/plans?org=${data.organizationSlug}&upgrade=cancelled`,
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
