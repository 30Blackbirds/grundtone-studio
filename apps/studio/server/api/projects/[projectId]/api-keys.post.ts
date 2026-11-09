import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { generateApiKey } from '~~/server/lib/api-keys'
import { API_KEY_ENVIRONMENTS } from '~~/server/lib/constants'
import { grantMachineProjectRole } from '~~/server/lib/authorizer'
import { requireProjectAccess } from '~~/server/lib/project-access'

const bodySchema = z.object({
  environment: z.enum(API_KEY_ENVIRONMENTS).default(API_KEY_ENVIRONMENTS[0]),
  // `publishable` (pk_) = read-only CDN key. `secret` (sk_) = editor-write key
  // for headless token management (CLI); its editor grant is a PDP machine tuple.
  keyType: z.enum(['publishable', 'secret']).default('publishable'),
  allowedOrigins: z.array(z.string().min(1).max(200)).max(20).default([]),
  // Per-key requests-per-minute cap enforced by the /k/[key] handler.
  // Default matches the DB default (1000) so existing callers that omit
  // the field stay on the same plan they had before this field was
  // editable. Upper bound 1_000_000 is plenty of headroom without
  // exposing us to integer-overflow surprises.
  rateLimit: z.number().int().min(1).max(1_000_000).default(1000),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Genererer en ny publishable API-nøgle (returnerer plaintext én gang); kræver projekt-admin.',
    description:
      'Genererer en ny publishable API-nøgle og returnerer plaintext-værdien én gang (kun hash gemmes). Kræver projekt-admin.',
    tags: ['API-keys'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'admin')

  const parsed = bodySchema.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const generated = generateApiKey(parsed.data.environment, parsed.data.keyType)

  const [created] = await db
    .insert(apiKey)
    .values({
      projectId,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      keyType: parsed.data.keyType,
      environment: parsed.data.environment,
      allowedOrigins: parsed.data.allowedOrigins,
      rateLimit: parsed.data.rateLimit,
      createdBy: access.userId,
      createdByEmail: event.context.auth?.email ?? null,
    })
    .returning({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      keyType: apiKey.keyType,
      environment: apiKey.environment,
      allowedOrigins: apiKey.allowedOrigins,
      rateLimit: apiKey.rateLimit,
      createdAt: apiKey.createdAt,
    })

  // A secret key writes tokens as a `machine:{keyId}` principal — grant it the
  // editor tuple in the PDP (rides on the admin's browser JWT so tenant is
  // derived server-side). If the grant fails, roll the key back so no
  // authority-less secret is left behind.
  if (parsed.data.keyType === 'secret') {
    try {
      await grantMachineProjectRole(event, projectId, created.id, 'editor')
    } catch (err) {
      await db.delete(apiKey).where(eq(apiKey.id, created.id))
      throw err
    }
  }

  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: created.id,
    targetLabel: `${created.keyPrefix} (${access.project.name})`,
    after: {
      keyType: created.keyType,
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
