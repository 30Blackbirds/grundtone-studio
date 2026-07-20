import { and, eq, isNull } from 'drizzle-orm'
import { getRequestHeader, type H3Event } from 'h3'
import { db } from '~~/server/db'
import { apiKey, project } from '~~/server/db/schema'
import { hashApiKey } from './api-keys'

// A secret key arrives as `Authorization: Bearer sk_...` (never in a URL, unlike
// the publishable `pk_` CDN keys).
const MACHINE_BEARER_PREFIX = 'Bearer sk_'

/**
 * Authenticate a request bearing a per-project secret key (`sk_...`).
 *
 * On a valid, non-revoked secret key it exchanges the key for a short-lived
 * `machine:{keyId}` JWT at the central auth service (`POST /api/auth/machine-token`,
 * s2s-authenticated with MACHINE_TOKEN_SERVICE_SECRET) and populates
 * `event.context.auth` + `event.context.authToken`. The existing
 * `requireProjectAccess`/PDP path then adjudicates the machine's editor tuple —
 * which is granted only on the key's own project, so a request targeting any
 * other project fails the Check (least privilege).
 *
 * Never throws (mirrors the session middleware): an invalid/revoked key, an
 * unconfigured exchange, or a failed exchange all leave `context.auth` undefined
 * and let the route guard reject with 401. Only does work when an `sk_` bearer is
 * present, so it is a no-op for browser (cookie) and public requests.
 */
export async function authenticateMachineKey(event: H3Event): Promise<void> {
  const authz = getRequestHeader(event, 'authorization')
  if (!authz?.startsWith(MACHINE_BEARER_PREFIX)) return

  const plaintext = authz.slice('Bearer '.length)
  const keyHash = hashApiKey(plaintext)

  const [row] = await db
    .select({ id: apiKey.id, projectId: apiKey.projectId, organizationId: project.organizationId })
    .from(apiKey)
    .innerJoin(project, eq(project.id, apiKey.projectId))
    .where(and(eq(apiKey.keyHash, keyHash), eq(apiKey.keyType, 'secret'), isNull(apiKey.revokedAt)))
  if (!row) return

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
    event.context.auth = { sub: `machine:${row.id}`, tenant: row.organizationId ?? null }
  } catch {
    // Exchange unreachable/failed — leave unauthenticated; the guard 401s.
  }
}
