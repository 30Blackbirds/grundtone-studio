import { and, eq, isNull } from 'drizzle-orm'
import { getRequestHeader, type H3Event } from 'h3'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { hashApiKey } from './api-keys'
import { recordKeyUse } from './key-usage'

// Authenticate an ORG-scoped provisioning key (KH-964).
//
// A provisioning key arrives as `Authorization: Bearer prov_…` — never in a URL,
// like `sk_` and unlike the publishable `pk_` CDN keys.
const PROVISIONING_BEARER_PREFIX = 'Bearer prov_'

export interface ProvisioningPrincipal {
  keyId: string
  organizationId: string
}

/**
 * 🔴 THE LOOKUP HAPPENS ON EVERY REQUEST, AND THAT IS THE CRITERION, NOT AN
 * IMPLEMENTATION DETAIL. AC-A3 requires that the NEXT request after a revoke is
 * refused with 401 — explicitly "not only after the machine JWT's 15 minutes".
 * So there is deliberately:
 *
 *   - no cache of the key→org mapping (the CDN route has a 30 s TTLCache for
 *     `pk_` keys; a 30 s window in which a revoked PROVISIONING key still
 *     creates projects and mints other keys is a different order of risk), and
 *   - no token minted once and reused across requests.
 *
 * `isNull(revokedAt)` is therefore part of the query, not a check applied to a
 * cached row. If someone adds a cache here later, AC-A3 is no longer met, and
 * the cell `a revoked key is refused on the very next call` is what turns red.
 *
 * Never throws (mirrors the session and machine middleware): an unknown or
 * revoked key leaves `context.provisioning` undefined and lets the route guard
 * answer 401. Only does work when a `prov_` bearer is present, so it is a no-op
 * for browser, CDN and `sk_` traffic.
 */
export async function authenticateProvisioningKey(event: H3Event): Promise<void> {
  const authz = getRequestHeader(event, 'authorization')
  if (!authz?.startsWith(PROVISIONING_BEARER_PREFIX)) return

  const plaintext = authz.slice('Bearer '.length)
  const keyHash = hashApiKey(plaintext)

  const [row] = await db
    .select({ id: apiKey.id, organizationId: apiKey.organizationId })
    .from(apiKey)
    .where(
      and(
        eq(apiKey.keyHash, keyHash),
        eq(apiKey.keyType, 'provisioning'),
        isNull(apiKey.revokedAt),
      ),
    )
  // 🔴 `organizationId` is nullable on the table, so a row whose scope is
  // missing is refused rather than narrowed. A provisioning key without an org
  // has no tenant to act in; the check constraint should make this unreachable,
  // and if it ever is reached the answer must be "no", not "undefined".
  if (!row || row.organizationId === null) return

  recordKeyUse(keyHash)

  event.context.provisioning = {
    keyId: row.id,
    organizationId: row.organizationId,
  } satisfies ProvisioningPrincipal
}
