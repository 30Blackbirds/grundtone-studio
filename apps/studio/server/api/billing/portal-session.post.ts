import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { postToAccount, requireAccountUrl } from '~~/server/lib/account-relay'
import { PORTAL_KEY } from '~~/server/lib/entitlements'
import { requireAuthedRequest, requireOrg } from '~~/server/lib/org-request'

const bodySchema = z.object({ organizationSlug: z.string().min(1) })

defineRouteMeta({
  openAPI: {
    summary: 'Minter en Stripe Billing Portal-session via account (§7a, kortskifte).',
    description:
      'S2S-relay til accounts POST /v1/billing/portal-sessions — "Opdatér via Stripe" på /orgs/:slug/billing. Ingen kortdata krydser nogensinde Studio. 503 dormant uden ACCOUNT_URL.',
    tags: ['Billing'],
  },
})

export default defineEventHandler(async (event) => {
  const { actor, data } = requireAuthedRequest(event, bodySchema, await readBody(event))

  const org = await requireOrg(event, actor, data.organizationSlug, 'billing')

  const accountUrl = requireAccountUrl()
  const appUrl = useRuntimeConfig(event).public.appUrl

  const { portalUrl } = await postToAccount<{ portalUrl: string }>(
    accountUrl,
    '/v1/billing/portal-sessions',
    {
      tenantOrgId: org.id,
      portalKey: PORTAL_KEY,
      returnUrl: `${appUrl}/orgs/${data.organizationSlug}/billing`,
    },
    { statusMessage: 'Could not create portal session', code: 'portal_failed' },
  )
  return { portalUrl }
})
