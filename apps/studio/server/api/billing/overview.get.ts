import { createError, defineEventHandler, getQuery } from 'h3'
import { z } from 'zod'
import { getBillingInvoices, getBillingSubscription } from '~~/server/lib/billing-read'
import { lookupOrgBySlug } from '~~/server/lib/org-lookup'
import { orgRoleHelpers, type OrgRole } from '~~/server/lib/project-access'

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
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const org = await lookupOrgBySlug(event, parsed.data.organizationSlug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  const role = org.members?.find((m) => m.userId === actor.sub)?.role
  if (!role || !orgRoleHelpers.canManageBilling(role as OrgRole)) {
    throw createError({ statusCode: 403, statusMessage: 'Requires the owner or billing role' })
  }

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
