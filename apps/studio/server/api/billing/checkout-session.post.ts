import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { CHECKOUT_PLAN_KEYS, getPlan, type PlanKey } from '~~/lib/plan-catalog'
import { postToAccount, requireAccountUrl } from '~~/server/lib/account-relay'
import { currentBrandCount } from '~~/server/lib/brand-count'
import { assertBetaPurchasesClosed } from '~~/server/lib/beta-purchases'
import { PORTAL_KEY } from '~~/server/lib/entitlements'
import { requireAuthedRequest, requireOrg } from '~~/server/lib/org-request'
import { provisionNow } from '~~/server/lib/tenant-outbox'

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
  planKey: z.enum(CHECKOUT_PLAN_KEYS),
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
  // Bliver stående FØR org-opslaget. MÅLT 2026-08-28: tjekket kan i dag ikke
  // fyre — `bodySchema`s enum admitterer kun studio_solo/_studio/_scale, og
  // alle tre er purchasable. Det er altså defence in depth, ikke en aktiv
  // gren, og placeringen er derfor uobserverbar lige nu. Den bliver
  // observerbar i samme øjeblik en ikke-købbar nøgle kommer ind i enummet:
  // så svarer en ukendt org med den nøgle 400 herfra i stedet for 404 fra
  // opslaget. Testen "hver plan i enummet er købbar" nedenfor er den, der
  // siger til, når den dag kommer.
  if (!getPlan(data.planKey as PlanKey).purchasable) {
    throw createError({ statusCode: 400, statusMessage: 'Plan is not purchasable' })
  }

  // Purchases change the org's billing relationship — Sentry-style role model
  // reserves that for owner/billing (not admin/manager, who manage people).
  const org = await requireOrg(event, actor, data.organizationSlug, 'billing')

  assertBetaPurchasesClosed(org.id, 'checkout')

  // Dormant-503 FØR runtime-config og body: et usat ACCOUNT_URL skal
  // rapportere sig som dormant, ikke som en fejl længere inde.
  const accountUrl = requireAccountUrl()

  // account#179 answers 404 unknown_tenant for an org it has no company for,
  // and the company comes from Studio's tenantProvisioned. Deliver it now
  // rather than leave a first-time buyer to the scheduled outbox run.
  if (!(await provisionNow(org))) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Billing is not available yet',
      data: { code: 'tenant_not_provisioned' },
    })
  }

  const appUrl = useRuntimeConfig(event).public.appUrl

  const { checkoutUrl } = await postToAccount<{ checkoutUrl: string }>(
    accountUrl,
    '/v1/billing/checkout-sessions',
    {
      tenantOrgId: org.id,
      portalKey: PORTAL_KEY,
      planKey: data.planKey,
      // So the purchase bills the right overage from day one; after that the
      // brand-count PUT keeps it current (server/lib/brand-count.ts).
      activeBrands: await currentBrandCount(org.id),
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
    },
    { statusMessage: 'Could not create checkout session', code: 'checkout_failed' },
  )
  return { checkoutUrl }
})
