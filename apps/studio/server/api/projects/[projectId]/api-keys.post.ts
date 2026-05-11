import { z } from 'zod'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { generateApiKey } from '~~/server/lib/api-keys'

const bodySchema = z.object({
  environment: z.enum(['live', 'test']).default('live'),
  allowedOrigins: z.array(z.string().min(1).max(200)).max(20).default([]),
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
      createdBy: access.userId,
    })
    .returning({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      environment: apiKey.environment,
      allowedOrigins: apiKey.allowedOrigins,
      createdAt: apiKey.createdAt,
    })

  return {
    ...created,
    plaintext: generated.plaintext,
  }
})
