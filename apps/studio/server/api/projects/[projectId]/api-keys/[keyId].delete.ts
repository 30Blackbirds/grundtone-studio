import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { requireProjectAccess } from '~~/server/lib/project-access'

defineRouteMeta({
  openAPI: {
    summary: 'Tilbagekalder (soft-revoke) en API-nøgle; kræver projekt-admin.',
    description: 'Soft-revoker en API-nøgle, så den ikke længere kan bruges. Kræver projekt-admin.',
    tags: ['API-keys'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  const keyId = getRouterParam(event, 'keyId')
  if (!projectId || !keyId) {
    throw createError({ statusCode: 400, statusMessage: 'projectId and keyId required' })
  }

  const access = await requireProjectAccess(event, projectId, 'admin')

  const [updated] = await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.id, keyId), eq(apiKey.projectId, projectId)))
    .returning({ id: apiKey.id, keyPrefix: apiKey.keyPrefix, revokedAt: apiKey.revokedAt })

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'API key not found' })

  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: updated.id,
    targetLabel: `${updated.keyPrefix} (${access.project.name})`,
  })

  return updated
})
