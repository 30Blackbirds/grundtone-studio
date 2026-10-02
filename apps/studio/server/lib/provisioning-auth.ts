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

  // 🔴 ALSO a machine principal, for the same reason `sk_` is one: the PDP is
  // what enforces least privilege, and it can only do that if it is asked. With
  // `auth` set, the existing editor-gated endpoints (write tokens, publish,
  // activate) work unchanged, and the PDP refuses this key on every project it
  // holds no tuple for — which is every project it did not create — and on
  // every `project.admin` operation (AC-D2/AC-D4). Hiding the principal from
  // those call sites instead would have meant duplicating each endpoint, and a
  // second copy of an authorisation path is how the two drift.
  //
  // Minted PER REQUEST and never stored: the token's own lifetime is then
  // irrelevant to revocation, which is what AC-A3 is about. An exchange that
  // cannot be reached leaves `auth` unset and the route answers 401 — the key
  // is still recorded as used, because it WAS presented and accepted.
  const authUrl = process.env.AUTH_INTERNAL_URL ?? process.env.AUTH_ISSUER
  const serviceSecret = process.env.MACHINE_TOKEN_SERVICE_SECRET
  if (!authUrl || !serviceSecret) return

  try {
    const res = await $fetch<{ token: string }>(`${authUrl}/api/auth/machine-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceSecret}` },
      body: { keyId: row.id, org: row.organizationId },
    })
    event.context.authToken = res.token
    event.context.auth = { sub: `machine:${row.id}`, tenant: row.organizationId }
  } catch {
    // Exchange unreachable/failed — leave unauthenticated; the guard 401s.
  }
}
