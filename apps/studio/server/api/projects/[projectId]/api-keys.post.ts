import { z } from 'zod'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { generateApiKey } from '~~/server/lib/api-keys'

const bodySchema = z.object({
  environment: z.enum(['live', 'test']).default('live'),
  allowedOrigins: z.array(z.string().min(1).max(200)).max(20).default([]),
  // Per-key requests-per-minute cap enforced by the /k/[key] handler.
  // Default matches the DB default (1000) so existing callers that omit
  // the field stay on the same plan they had before this field was
  // editable. Upper bound 1_000_000 is plenty of headroom without
  // exposing us to integer-overflow surprises.
  rateLimit: z.number().int().min(1).max(1_000_000).default(1000),
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'admin')

  const parsed = bodySchema.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const generated = generateApiKey(parsed.data.environment)

  const [created] = await db
    .insert(apiKey)
    .values({
      projectId,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      keyType: 'publishable',
      environment: parsed.data.environment,
      allowedOrigins: parsed.data.allowedOrigins,
      rateLimit: parsed.data.rateLimit,
      createdBy: access.userId,
    })
    .returning({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      environment: apiKey.environment,
      allowedOrigins: apiKey.allowedOrigins,
      rateLimit: apiKey.rateLimit,
      createdAt: apiKey.createdAt,
    })

  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: created.id,
    targetLabel: `${created.keyPrefix} (${access.project.name})`,
    after: {
      environment: created.environment,
      allowedOrigins: created.allowedOrigins,
      rateLimit: created.rateLimit,
    },
  })

  return {
    ...created,
    plaintext: generated.plaintext,
  }
})
