import { and, eq, isNull } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { orgRoleHelpers, requireOrgRole } from '~~/server/lib/project-access'

// Revoke an org-scoped provisioning key (KH-964 AC-A3).
//
// 🔴 THE CRITERION IS ABOUT THE NEXT REQUEST, NOT ABOUT THIS ONE. AC-A3 says the
// next request with the key is refused with 401 — "not only after the machine
// JWT's 15 minutes". A soft-revoke here is therefore only half the work: it is
// worth nothing unless the path that AUTHENTICATES the key re-reads
// `revokedAt` on every request rather than trusting a token it minted earlier.
// That half lives in server/lib/provisioning-auth.ts, and its cell is the one
// that measures the criterion. This endpoint only writes the fact.
//
// Scoped by `organizationId` in the WHERE clause, not just by keyId: a key id
// from another org must 404 rather than be revoked across a tenant boundary.

defineRouteMeta({
  openAPI: {
    summary: 'Tilbagekalder (soft-revoke) en provisioning-nøgle; kræver org-admin eller højere.',
    description:
      'Soft-revoker en org-scopet provisioning-nøgle. Næste request med nøglen afvises med 401. Kræver den samme rolle som projekt-oprettelse.',
    tags: ['Org', 'API-keys'],
  },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  const keyId = getRouterParam(event, 'keyId')
  if (!orgId || !keyId) {
    throw createError({ statusCode: 400, statusMessage: 'orgId and keyId required' })
  }

  const access = await requireOrgRole(event, orgId, 'member')
  if (!orgRoleHelpers.canCreateProjects(access.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Requires an org role that can create projects (owner, manager or admin)',
    })
  }

  const [updated] = await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKey.id, keyId),
        // 🔴 Both scope AND type. Without the type check, this endpoint could
        // revoke a `pk_`/`sk_` key that happened to share the id space — and it
        // would do so outside the project-admin gate those keys are protected
        // by. Narrowing here is cheaper than trusting that ids never collide.
        eq(apiKey.organizationId, orgId),
        eq(apiKey.keyType, 'provisioning'),
        // Already-revoked keys 404 rather than silently re-stamping a new
        // revokedAt, so the audit trail keeps the FIRST revocation time.
        isNull(apiKey.revokedAt),
      ),
    )
    .returning({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      keyType: apiKey.keyType,
      revokedAt: apiKey.revokedAt,
    })

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Provisioning key not found' })
  }

  await recordAuditEvent(event, {
    organizationId: orgId,
    action: 'provisioning_key.revoked',
    targetType: 'api_key',
    targetId: updated.id,
    targetLabel: updated.keyPrefix,
  })

  return updated
})
