import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  const keyId = getRouterParam(event, 'keyId')
  if (!projectId || !keyId) {
    throw createError({ statusCode: 400, statusMessage: 'projectId and keyId required' })
  }

  await requireProjectAccess(event, projectId, 'admin')

  const [updated] = await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.id, keyId), eq(apiKey.projectId, projectId)))
    .returning({ id: apiKey.id, revokedAt: apiKey.revokedAt })

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'API key not found' })

  return updated
})
