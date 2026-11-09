import { defineEventHandler, getQuery } from 'h3'
import { z } from 'zod'
import { getBillingInvoices, getBillingSubscription } from '~~/server/lib/billing-read'
import { requireAuthedRequest, requireOrg } from '~~/server/lib/org-request'
import { requireBillingEnabled } from '~~/server/lib/runtime-flags'

const querySchema = z.object({ organizationSlug: z.string().min(1) })

defineRouteMeta({
  openAPI: {
    summary: 'Fakturerings-overblik for en org (S2S-relay til accounts §7-mirror).',
    description:
      "Samler subscription + fakturahistorik fra accounts read-mirror i ét kald til /orgs/:slug/billing-siden. available=false når account-API'et ikke er konfigureret/nede — ren read, ingen gates påvirkes.",
    tags: ['Billing'],
  },
})

export default defineEventHandler(async (event) => {
  requireBillingEnabled()
  const { actor, data } = requireAuthedRequest(event, querySchema, getQuery(event))

  const org = await requireOrg(event, actor, data.organizationSlug, 'billing')

  const [subscription, invoices] = await Promise.all([
    getBillingSubscription(org.id),
    getBillingInvoices(org.id),
  ])

  return {
    available: subscription !== null,
    subscription,
    invoices: invoices ?? [],
    memberCount: org.members?.length ?? 0,
  }
})
