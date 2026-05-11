import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { project } from '~~/server/db/schema'
import { auth } from '~~/server/lib/auth'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { organizationSlug } = getQuery(event)
  if (typeof organizationSlug !== 'string' || !organizationSlug) {
    throw createError({ statusCode: 400, statusMessage: 'organizationSlug required' })
  }

  const org = await auth.api.getFullOrganization({
    headers: event.headers,
    query: { organizationSlug },
  })
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  return db.select().from(project).where(eq(project.organizationId, org.id))
})
