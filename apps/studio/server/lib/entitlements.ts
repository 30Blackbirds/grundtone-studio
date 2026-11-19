import { createError } from 'h3'
import { z } from 'zod'
import { selfHostProvider } from './entitlements-self-host'

// Where an organization's plan, features and limits come from, and the pure
// rules that turn them into allow or refuse (the locked entitlements contract,
// .orchestration/STUDIO-KVOTE-ENTITLEMENTS-KONTRAKT.md, 2026-07-29):
// - quota LIMITS come from the provider; the COUNT lives here
// - absent limits key = unlimited; 0 = hard zero
// - quota gates fail OPEN when the provider cannot answer (Allan's lockout ban);
//   the one paid feature, provisioning, fails CLOSED (see below)
//
// The default provider is self-host (entitlements-self-host.ts): no plan, every
// feature, limits only from the environment, and it always answers. A layer
// installs another provider with setEntitlementsProvider (the hosted service
// asks its account system).

export const entitlementsSchema = z.object({
  planKey: z.string(),
  planState: z.enum(['active', 'grace', 'suspended', 'canceled']),
  graceUntil: z.string().nullable(),
  features: z.array(z.string()),
  limits: z.record(z.string(), z.number()),
  asOf: z.string(),
})

export type Entitlements = z.infer<typeof entitlementsSchema>

/**
 * Where an org's entitlements come from. `get` answers null for 'could not
 * answer'; callers keep their own fail-open (quotas) and fail-closed (paid
 * feature) rules. `invalidate` drops any cached answer for one org.
 * `brandLimitIsHardCap` says whether `studio.brands` blocks at the limit or is
 * a billed allowance that may be exceeded; absent means it may be exceeded.
 */
export interface EntitlementsProvider {
  get(orgId: string): Promise<Entitlements | null>
  invalidate?(orgId: string): void
  brandLimitIsHardCap?(entitlements: Entitlements | null): boolean
}

let override: EntitlementsProvider | null = null

/** Extension point: a layer or plugin installs its own provider. Pass null to reset. */
export function setEntitlementsProvider(provider: EntitlementsProvider | null): void {
  override = provider
}

/** The provider in force: an installed one, else self-host. */
export function currentEntitlementsProvider(): EntitlementsProvider {
  return override ?? selfHostProvider
}

export async function getStudioEntitlements(orgId: string): Promise<Entitlements | null> {
  return currentEntitlementsProvider().get(orgId)
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
 * The limit is `studio.brands`, but it only blocks when the provider says it is
 * a hard cap (`brandLimitIsHardCap`): a plan may instead allow going over it and
 * bill per extra brand. `hardCap` is therefore an input, not derived here.
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
 *   - `entitlements_unavailable` (503): the provider gave no answer, whether it
 *     is unreachable or unconfigured. For a paid feature both mean "we do not
 *     know", which is not "yes". The self-host provider never answers null.
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

/** Throws the verdict as an H3 error; returns when the org may use provisioning. */
export async function requireProvisioningFeature(orgId: string): Promise<void> {
  // No early return for self-host: its provider always answers and carries
  // every feature (D-E2, entitlements-self-host.ts), so it passes the same gate.
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
