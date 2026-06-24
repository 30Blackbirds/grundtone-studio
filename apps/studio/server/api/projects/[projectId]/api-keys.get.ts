import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'

defineRouteMeta({
  openAPI: {
    summary: 'Lister projektets API-nøgler (metadata, ikke plaintext); kræver projekt-admin.',
    description:
      'Returnerer metadata for projektets API-nøgler (aldrig plaintext). Kræver projekt-admin.',
    tags: ['API-keys'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  await requireProjectAccess(event, projectId, 'admin')

  const keys = await db
    .select({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      keyType: apiKey.keyType,
      environment: apiKey.environment,
      allowedOrigins: apiKey.allowedOrigins,
      rateLimit: apiKey.rateLimit,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
      createdBy: apiKey.createdBy,
      createdByEmail: apiKey.createdByEmail,
    })
    .from(apiKey)
    .where(eq(apiKey.projectId, projectId))

  return keys
})
