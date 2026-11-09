import { createError } from 'h3'
import { z } from 'zod'
import { billingEnabled } from './runtime-flags'

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
// Contract §2 (v1.1): fresh ≤60s → background refresh → serve stale up to 24h.
const STALE_MAX_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<Entitlements | null>>()

/** Test hook — the cache is module-level state. */
export function clearEntitlementsCache() {
  cache.clear()
  inflight.clear()
}

/** Contract §2: explicit refetch on checkout-success — bust one org's entry. */
export function clearEntitlementsCacheFor(orgId: string) {
  cache.delete(orgId)
}

export async function getStudioEntitlements(orgId: string): Promise<Entitlements | null> {
  const baseUrl = process.env.ACCOUNT_URL
  if (!baseUrl) return null

  const cached = cache.get(orgId)
  const age = cached ? Date.now() - cached.fetchedAt : Infinity
  if (cached && age < TTL_MS) return cached.body
  if (cached && age < STALE_MAX_MS) {
    // Stale-while-revalidate: answer from cache now, refresh in the background.
    void refresh(baseUrl, orgId, cached)
    return cached.body
  }
  return await refresh(baseUrl, orgId, cached)
}

async function refresh(
  baseUrl: string,
  orgId: string,
  cached: CacheEntry | undefined,
): Promise<Entitlements | null> {
  const running = inflight.get(orgId)
  if (running) return running
  const p = doFetch(baseUrl, orgId, cached).finally(() => inflight.delete(orgId))
  inflight.set(orgId, p)
  return p
}

async function doFetch(
  baseUrl: string,
  orgId: string,
  cached: CacheEntry | undefined,
): Promise<Entitlements | null> {
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
    // Stale beats nothing within the contract's 24h window; beyond it → null
    // (fail-open for quotas either way, per §4).
    if (cached && Date.now() - cached.fetchedAt < STALE_MAX_MS) return cached.body
    return null
  }
}

export type QuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'quota_exceeded'; limit: number }
  | { allowed: false; reason: 'suspended' }

/**
 * Contract §1+§4 (v1.1, LOCKED) as a pure function: absent key = unlimited,
 * suspended = fail-closed on everything, grace = active until graceUntil
 * (expired grace blocks creation like suspended — account flips the state
 * server-side, this only covers the cache-staleness window), null = fail-open.
 * `canceled` is the portal-without-default-plan edge case and quotas stay
 * fail-OPEN there (account's ruling); normal expiry never reaches Studio as
 * canceled — account resolves those orgs to the portal default plan.
 * `limits` are enforced as delivered; account guarantees they reflect the
 * org's EFFECTIVE plan regardless of lifecycle.
 */
export function evaluateProjectQuota(
  entitlements: Entitlements | null,
  currentCount: number,
): QuotaVerdict {
  const lifecycle = lifecycleVerdict(entitlements)
  if (lifecycle) return lifecycle
  // lifecycleVerdict returns null only for a present, non-blocking entitlement.
  const limit = entitlements!.limits['studio.projects']
  if (limit === undefined) return { allowed: true }
  if (currentCount < limit) return { allowed: true }
  return { allowed: false, reason: 'quota_exceeded', limit }
}

/**
 * The plan-state part of contract §4, shared by every quota so they cannot
 * drift apart: null entitlements = fail-open, suspended and expired grace =
 * blocked, canceled = open. Returns null when the quota's own limit decides.
 */
function lifecycleVerdict(
  entitlements: Entitlements | null,
): { allowed: true } | { allowed: false; reason: 'suspended' } | null {
  if (!entitlements) return { allowed: true }
  if (entitlements.planState === 'suspended') return { allowed: false, reason: 'suspended' }
  if (entitlements.planState === 'canceled') return { allowed: true }
  if (
    entitlements.planState === 'grace' &&
    entitlements.graceUntil &&
    Date.parse(entitlements.graceUntil) < Date.now()
  ) {
    return { allowed: false, reason: 'suspended' }
  }
  return null
}

export type BrandQuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'brand_quota_exceeded'; limit: number }
  | { allowed: false; reason: 'suspended' }

/**
 * Active-brand quota (riff bfxmm7xktk6xkfanh5eennva). A brand is a project
 * with an active version, so this is evaluated only when a project is about to
 * get its FIRST active version.
 *
 * The limit comes from account (`studio.brands`), but only plans whose catalog
 * entry is a hard cap are blocked at the limit: plans with overage (Studio,
 * Scale) may exceed it and are billed per extra brand (tier doc, Allan-locked
 * 2026-08-02). `hardCap` is therefore an input, not derived here.
 */
export function evaluateBrandQuota(
  entitlements: Entitlements | null,
  activeBrandCount: number,
  hardCap: boolean,
): BrandQuotaVerdict {
  const lifecycle = lifecycleVerdict(entitlements)
  if (lifecycle) return lifecycle
  if (!hardCap) return { allowed: true }
  const limit = entitlements!.limits['studio.brands']
  if (limit === undefined) return { allowed: true }
  if (activeBrandCount < limit) return { allowed: true }
  return { allowed: false, reason: 'brand_quota_exceeded', limit }
}

/** The bool feature that unlocks org-scoped provisioning keys (KH-964). Same
 *  string as account's `STUDIO_PROVISIONING_API` and the PDP tuple object. */
export const PROVISIONING_FEATURE = 'studio.provisioning_api'

export type FeatureVerdict =
  | { allowed: true }
  | { allowed: false; status: 503; code: 'entitlements_unavailable' }
  | { allowed: false; status: 403; code: 'suspended' }
  | { allowed: false; status: 403; code: 'feature_not_enabled' }

/**
 * Contract §4 for a PAID BOOL FEATURE (KH-964 AC-E1–E3), as a pure function.
 *
 * 🔴 THIS FAILS CLOSED, AND THE QUOTA GATES ABOVE FAIL OPEN — ON PURPOSE. §4
 * splits the two: a quota bypass is at most temporary free usage, so quotas
 * never block on an infrastructure fault (Allan's lockout ban). A paid feature
 * is revenue and access, so "account could not answer" is a refusal. Do not
 * "harmonise" this with `lifecycleVerdict`'s null = allowed.
 *
 * Three refusals, each with its own code so a caller can tell them apart
 * (AC-E2 requires unavailable to be distinguishable from not-enabled):
 *
 *   - `entitlements_unavailable` (503): no answer from account. That includes
 *     an UNCONFIGURED client (no ACCOUNT_URL) — `getStudioEntitlements` returns
 *     null for both, and for a paid feature both mean "we do not know", which
 *     is not "yes". A stale answer inside the 24 h window is an answer.
 *   - `suspended` (403): suspended, an expired grace, or `canceled` (§4: a
 *     portal without a default plan is treated as suspended for paid features).
 *     Checked before the feature, so a suspended org on a paid plan hears
 *     "suspended" and not "upgrade".
 *   - `feature_not_enabled` (403): the effective plan does not carry the key —
 *     `studio-free` and `studio-legacy` today.
 */
export function evaluateProvisioningFeature(entitlements: Entitlements | null): FeatureVerdict {
  if (!entitlements) return { allowed: false, status: 503, code: 'entitlements_unavailable' }
  if (entitlements.planState === 'canceled')
    return { allowed: false, status: 403, code: 'suspended' }
  const lifecycle = lifecycleVerdict(entitlements)
  if (lifecycle && !lifecycle.allowed) return { allowed: false, status: 403, code: 'suspended' }
  if (!entitlements.features.includes(PROVISIONING_FEATURE)) {
    return { allowed: false, status: 403, code: 'feature_not_enabled' }
  }
  return { allowed: true }
}

const FEATURE_MESSAGES: Record<Exclude<FeatureVerdict, { allowed: true }>['code'], string> = {
  entitlements_unavailable: 'Plan entitlements are unavailable; the provisioning API fails closed',
  suspended: 'The organization is suspended',
  feature_not_enabled: "The organization's plan does not include the provisioning API",
}

/**
 * 🔴 UNDECIDED ON PURPOSE (ClickUp 1amk32fn9r6, decision D-E2). With
 * FEATURE_BILLING=off there is no plan, and what a paid feature does then is
 * Allan's choice: (a) every org has it (self-host), or (b) every org is on the
 * free plan and does not. Picking either here would make that choice in code.
 *
 * Until it is made, the gate refuses with its own code and status, so the
 * answer cannot be mistaken for either side: not 403 `feature_not_enabled`
 * (that is (b)) and not a grant (that is (a)). 501 says "this deployment has
 * not decided", which is the true state. Replace this function, and its cells,
 * with the decided rule.
 */
export function billingOffFeatureVerdict(): {
  allowed: false
  status: 501
  code: 'billing_off_undecided'
} {
  return { allowed: false, status: 501, code: 'billing_off_undecided' }
}

/** Throws the verdict as an H3 error; returns when the org may use provisioning. */
export async function requireProvisioningFeature(orgId: string): Promise<void> {
  if (!billingEnabled()) {
    const off = billingOffFeatureVerdict()
    throw createError({
      statusCode: off.status,
      statusMessage: 'Paid features with billing off are not decided for this deployment',
      data: { code: off.code },
    })
  }
  const verdict = evaluateProvisioningFeature(await getStudioEntitlements(orgId))
  if (verdict.allowed) return
  if (verdict.code === 'entitlements_unavailable') {
    console.error(`[entitlements] provisioning refused for org ${orgId}: entitlements unavailable`)
  }
  throw createError({
    statusCode: verdict.status,
    statusMessage: FEATURE_MESSAGES[verdict.code],
    data: { code: verdict.code },
  })
}
