import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { db } from '~~/server/db'
import { apiKey, project } from '~~/server/db/schema'
import { generateApiKey } from '~~/server/lib/api-keys'
import { recordAuditEvent } from '~~/server/lib/audit'
import { API_KEY_ENVIRONMENTS } from '~~/server/lib/constants'

// Mint a publishable (`pk_`) key for a project, using a provisioning key
// (KH-964 AC-C1).
//
// 🔴 WHY THIS ENDPOINT EXISTS AT ALL, rather than reusing
// /projects/{id}/api-keys. That one gates on `requireProjectAccess(…, 'admin')`,
// and AC-D4 requires that a machine NEVER holds `project.admin` — admin carries
// member management and key administration, which AC-D2 refuses to provisioning
// keys. So the provisioning key cannot pass that gate, and granting it admin to
// make it pass would defeat the criterion it is being gated by.
//
// The authority here is therefore NOT a project role. It is: this caller holds a
// provisioning key, and the project belongs to THAT key's organisation. Both
// halves are checked below, and the second is checked against the DATABASE
// rather than against the path — a caller who can name an orgId cannot thereby
// move a project into it.
//
// 🔴 ONLY `pk_`. A publishable key is read-only and lives in a URL. Minting
// `sk_` here would hand a project-editor machine principal to whoever holds the
// provisioning key, outside the project-admin gate that `sk_` is protected by —
// so the body cannot ask for a type at all.

const bodySchema = z.object({
  environment: z.enum(API_KEY_ENVIRONMENTS).default(API_KEY_ENVIRONMENTS[0]),
  allowedOrigins: z.array(z.string().min(1).max(200)).max(20).default([]),
  rateLimit: z.number().int().min(1).max(1_000_000).default(1000),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Minter en publishable (pk_) nøgle for et projekt via en provisioning-nøgle. Projektet skal tilhøre nøglens org.',
    description:
      'Genererer en pk_-nøgle til projektet og returnerer plaintext én gang. Autorisationen er provisioning-nøglen plus at projektet tilhører dens organisation — ikke en projekt-rolle, da en maskine aldrig holder project.admin. Rate-limit: nøglens rateLimit-kald pr. 60 s-vindue (default 1000, sættes pr. nøgle ved oprettelse); over grænsen svares 429 med Retry-After-header og code: rate_limit_exceeded.',
    tags: ['Org', 'Provisioning', 'API-keys'],
  },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  const projectId = getRouterParam(event, 'projectId')
  if (!orgId || !projectId) {
    throw createError({ statusCode: 400, statusMessage: 'orgId and projectId required' })
  }

  const principal = event.context.provisioning
  if (!principal) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Provisioning key required',
      data: { code: 'provisioning_key_required' },
    })
  }

  if (principal.organizationId !== orgId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This provisioning key belongs to another organization',
      data: { code: 'wrong_organization' },
    })
  }

  const parsed = bodySchema.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message,
      data: { code: 'invalid_body' },
    })
  }

  // 🔴 THE PROJECT'S OWN ROW DECIDES WHICH ORG IT IS IN, not the path. A 404 and
  // not a 403: a project in another org must be indistinguishable from one that
  // does not exist, or this endpoint becomes a way to enumerate other tenants'
  // project ids.
  const [owned] = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, orgId)))
  if (!owned) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found in this organization',
      data: { code: 'project_not_found' },
    })
  }

  const generated = generateApiKey(parsed.data.environment, 'publishable')

  const [created] = await db
    .insert(apiKey)
    .values({
      projectId: owned.id,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      keyType: 'publishable',
      environment: parsed.data.environment,
      allowedOrigins: parsed.data.allowedOrigins,
      rateLimit: parsed.data.rateLimit,
      // The actor is the provisioning KEY, not a person. Audit must be able to
      // answer "who minted this?" with something that exists.
      createdBy: `machine:${principal.keyId}`,
      createdByEmail: null,
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

  await recordAuditEvent(event, {
    organizationId: orgId,
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: created.id,
    targetLabel: `${created.keyPrefix} (${owned.name})`,
    after: {
      keyType: created.keyType,
      environment: created.environment,
      allowedOrigins: created.allowedOrigins,
      rateLimit: created.rateLimit,
      mintedBy: `machine:${principal.keyId}`,
    },
  })

  return { ...created, plaintext: generated.plaintext }
})
