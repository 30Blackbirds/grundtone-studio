import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { generateApiKey } from '~~/server/lib/api-keys'
import { recordAuditEvent } from '~~/server/lib/audit'
import { requireProvisioningFeature } from '~~/server/lib/entitlements'
import { API_KEY_ENVIRONMENTS } from '~~/server/lib/constants'
import { orgRoleHelpers, requireOrgRole } from '~~/server/lib/project-access'

// Mint an ORG-scoped provisioning key (KH-964 AC-A1/A2).
//
// 🔴 WHY THIS IS NOT api-keys.post.ts WITH A THIRD ENUM VALUE. That endpoint is
// `/projects/{projectId}/api-keys` and gates on `requireProjectAccess(…,
// 'admin')` — a project admin. A provisioning key exists to CREATE projects, so
// there is no project to be admin of, and routing it through a project would
// have meant picking an arbitrary one to hang the authority on.
//
// 🔴 WHO MAY MINT ONE, and why it reuses an existing predicate rather than a
// new one: `orgRoleHelpers.canCreateProjects` (owner · manager · admin). A
// provisioning key's whole power is creating projects and minting their keys,
// so the right to mint one IS the right to create projects. A fourth predicate
// would be a second answer to the same question, and the two would drift.
// `member` and `billing` are therefore refused (AC-A2), and the cell asserts
// the refusal for both.

const bodySchema = z.object({
  environment: z.enum(API_KEY_ENVIRONMENTS).default(API_KEY_ENVIRONMENTS[0]),
  // Sized like the project keys so one number does not quietly mean two things.
  rateLimit: z.number().int().min(1).max(1_000_000).default(1000),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Minter en org-scopet provisioning-nøgle (prov_) og returnerer plaintext én gang. Kræver org-admin eller højere.',
    description:
      'Genererer en provisioning-nøgle for organisationen. Plaintext vises præcis én gang; kun hash gemmes. Kræver den samme rolle som projekt-oprettelse (owner, manager eller admin). Body.rateLimit = kald pr. 60 s-vindue (default 1000); grænsen håndhæves ved autentificeringen og gælder derfor på hver rute nøglen når. Over grænsen: 429 med Retry-After-header og code: rate_limit_exceeded.',
    tags: ['Org', 'API-keys'],
  },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })

  // 'member' is the floor requireOrgRole can check; the real gate is the
  // predicate below, so that "who may create projects" has ONE definition.
  const access = await requireOrgRole(event, orgId, 'member')
  if (!orgRoleHelpers.canCreateProjects(access.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Requires an org role that can create projects (owner, manager or admin)',
    })
  }

  // AC-E1: an org whose plan lacks the provisioning API cannot MINT a key
  // either, not only use one — a key it could never use would be a lie.
  await requireProvisioningFeature(orgId)

  const parsed = bodySchema.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const generated = generateApiKey(parsed.data.environment, 'provisioning')

  const [created] = await db
    .insert(apiKey)
    .values({
      // 🔴 organizationId WITHOUT projectId. The check constraint
      // `api_key_scope_exclusive` refuses anything else; setting both would
      // make every existing project guard adjudicate this key as a project
      // key, which would read as a permission bug rather than a data bug.
      organizationId: orgId,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      keyType: 'provisioning',
      environment: parsed.data.environment,
      rateLimit: parsed.data.rateLimit,
      createdBy: access.userId,
      createdByEmail: event.context.auth?.email ?? null,
    })
    .returning({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      keyType: apiKey.keyType,
      environment: apiKey.environment,
      rateLimit: apiKey.rateLimit,
      createdAt: apiKey.createdAt,
    })

  await recordAuditEvent(event, {
    organizationId: orgId,
    action: 'provisioning_key.created',
    targetType: 'api_key',
    targetId: created.id,
    targetLabel: created.keyPrefix,
    after: { environment: created.environment, rateLimit: created.rateLimit },
  })

  // Plaintext exactly once — it is never stored and cannot be shown again.
  return { ...created, plaintext: generated.plaintext }
})
