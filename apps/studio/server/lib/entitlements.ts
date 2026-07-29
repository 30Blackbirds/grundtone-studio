import { z } from 'zod'

// Studio-side client for account's entitlements-API, per the locked contract
// .orchestration/STUDIO-KVOTE-ENTITLEMENTS-KONTRAKT.md (2026-07-29):
// - quota LIMITS live in account (FeatureCatalog); the COUNT lives here
// - absent limits key = unlimited; 0 = hard zero
// - quota gates fail-OPEN on entitlements unavailability (Allan's lockout-forbud;
//   paid plans have higher/no limits so there is no revenue leakage) — which also
//   makes this client dormant-by-design: no ACCOUNT_URL configured → null →
//   every caller allows, current behaviour preserved until account ships the API.
//
// ACCOUNT_URL/ACCOUNT_S2S_TOKEN are read from bare process.env like the other
// service endpoints (see runtimeConfig comment in nuxt.config.ts) so the env
// contract matches what [infra] provisions verbatim. The static token is an
// interim transport: swaps to an [auth]-minted S2S-JWT (aud=klanghaus-account)
// once their client-credentials mint flow lands.

export const PORTAL_KEY = 'grundtone-studio'

const entitlementsSchema = z.object({
  planKey: z.string(),
  planState: z.enum(['active', 'grace', 'suspended', 'canceled']),
  graceUntil: z.string().nullable(),
  features: z.array(z.string()),
  limits: z.record(z.string(), z.number()),
  asOf: z.string(),
})

export type Entitlements = z.infer<typeof entitlementsSchema>

interface CacheEntry {
  etag: string | null
  body: Entitlements
  fetchedAt: number
}

const TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()

/** Test hook — the cache is module-level state. */
export function clearEntitlementsCache() {
  cache.clear()
}

export async function getStudioEntitlements(orgId: string): Promise<Entitlements | null> {
  const baseUrl = process.env.ACCOUNT_URL
  if (!baseUrl) return null

  const cached = cache.get(orgId)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.body

  try {
    const headers: Record<string, string> = {}
    const token = process.env.ACCOUNT_S2S_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`
    if (cached?.etag) headers['If-None-Match'] = cached.etag

    const res = await fetch(
      `${baseUrl}/v1/entitlements/${encodeURIComponent(orgId)}?portal=${PORTAL_KEY}`,
      { headers, signal: AbortSignal.timeout(3_000) },
    )

    if (res.status === 304 && cached) {
      cached.fetchedAt = Date.now()
      return cached.body
    }
    if (!res.ok) throw new Error(`entitlements responded ${res.status}`)

    const parsed = entitlementsSchema.safeParse(await res.json())
    if (!parsed.success) throw new Error(`entitlements response invalid: ${parsed.error.message}`)

    cache.set(orgId, {
      etag: res.headers.get('etag'),
      body: parsed.data,
      fetchedAt: Date.now(),
    })
    return parsed.data
  } catch (err) {
    console.error(`[entitlements] fetch failed for org ${orgId} — quota gates fail open:`, err)
    // Stale beats nothing: an expired entry is closer to the truth than
    // unlimited, and the contract's fail-open only covers the no-data case.
    return cached?.body ?? null
  }
}

export type QuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'quota_exceeded'; limit: number }
  | { allowed: false; reason: 'suspended' }

/**
 * Contract §1+§4 as a pure function: absent key = unlimited, suspended =
 * fail-closed on everything, grace = active until graceUntil (expired grace
 * blocks creation like suspended — account flips the state server-side, this
 * only covers the cache-staleness window), null entitlements = fail-open.
 * `limits` are enforced as delivered; account guarantees they reflect the
 * org's EFFECTIVE plan regardless of planState (canceled → free limits).
 */
export function evaluateProjectQuota(
  entitlements: Entitlements | null,
  currentCount: number,
): QuotaVerdict {
  if (!entitlements) return { allowed: true }

  if (entitlements.planState === 'suspended') return { allowed: false, reason: 'suspended' }
  if (
    entitlements.planState === 'grace' &&
    entitlements.graceUntil &&
    Date.parse(entitlements.graceUntil) < Date.now()
  ) {
    return { allowed: false, reason: 'suspended' }
  }

  const limit = entitlements.limits.max_projects
  if (limit === undefined) return { allowed: true }
  if (currentCount < limit) return { allowed: true }
  return { allowed: false, reason: 'quota_exceeded', limit }
}
