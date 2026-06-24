import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { project } from '~~/server/db/schema'
import { lookupOrgBySlug } from '~~/server/lib/org-lookup'

defineRouteMeta({
  openAPI: {
    summary:
      'Lister projekter for en org (slug→id via central auth, scoped til kalderens medlemskab).',
    description:
      'Lister projekter for en org. Slug oversættes til org-id via den centrale auth-org-API og er scoped til kalderens medlemskab.',
    tags: ['Projects'],
  },
})

export default defineEventHandler(async (event) => {
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { organizationSlug } = getQuery(event)
  if (typeof organizationSlug !== 'string' || !organizationSlug) {
    throw createError({ statusCode: 400, statusMessage: 'organizationSlug required' })
  }

  // Resolve the slug to an org id via the central auth org API. The lookup is
  // scoped to the signed-in user's memberships, so a non-member gets 404.
  const org = await lookupOrgBySlug(event, organizationSlug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  return db.select().from(project).where(eq(project.organizationId, org.id))
})
