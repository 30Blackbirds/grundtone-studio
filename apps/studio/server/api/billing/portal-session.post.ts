import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
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

  const res = await fetch(`${accountUrl}/v1/billing/portal-sessions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      tenantOrgId: org.id,
      portalKey: PORTAL_KEY,
      returnUrl: `${appUrl}/orgs/${data.organizationSlug}/billing`,
    }),
  })
  if (!res.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not create portal session',
      data: { code: 'portal_failed' },
    })
  }

  const { portalUrl } = (await res.json()) as { portalUrl: string }
  return { portalUrl }
})
