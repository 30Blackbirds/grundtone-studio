import { createError } from 'h3'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, type Db } from '~~/server/db'
import { activeVersion, project } from '~~/server/db/schema'
import { PLAN_CATALOG } from '~~/lib/plan-catalog'
import {
  evaluateBrandQuota,
  getStudioEntitlements,
  type BrandQuotaVerdict,
  type Entitlements,
} from '~~/server/lib/entitlements'
import { recordQuotaDenial, recordQuotaFailOpen } from '~~/server/lib/metrics'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** What a caller needs to create a brand once its own transaction is open. */
export interface BrandClaim {
  organizationId: string
  entitlements: Entitlements | null
  hardCap: boolean
}

/**
 * Server-side enforcement of the active-brand cap (riffs bfxmm7xktk6xkfanh5eennva,
 * cjbjm73hjpwgh2c3eja8jry9).
 *
 * A project counts as a brand once it has an `active_version` row, and only two
 * routes write that row: publish and activate. Enforcement has two steps:
 *
 * 1. `assertBrandCapacity` runs before any write and refuses early without a
 *    lock. It returns null when the project is already a brand (republish and
 *    rollback at the cap keep working), otherwise the context for step 2.
 * 2. `claimBrandSlot` runs inside the caller's transaction. It repeats the check
 *    under a per-organization advisory lock and writes the `active_version` row
 *    in that same transaction, so the check and the brand commit together.
 *    Step 1 alone is not enough: two first publishes can both pass it before
 *    either writes.
 *
 * - Entitlements unavailable → fail-open (contract §4, quotas), counted.
 * - Plan not marked `hardCap` in the catalog, or unknown → allowed; overage
 *   plans are billed, not blocked.
 */
export async function assertBrandCapacity(
  organizationId: string,
  projectId: string,
): Promise<BrandClaim | null> {
  if (await isActive(db, projectId)) return null

  const entitlements = await getStudioEntitlements(organizationId)
  if (entitlements === null && process.env.ACCOUNT_URL) {
    recordQuotaFailOpen('studio.brands', 'entitlements_unavailable')
  }

  const hardCap = PLAN_CATALOG.find((p) => p.key === entitlements?.planKey)?.hardCap ?? false
  const claim: BrandClaim = { organizationId, entitlements, hardCap }
  assertAllowed(claim, needsCount(claim) ? await countActiveBrands(db, organizationId) : 0)
  return claim
}

/**
 * Creates the brand inside `tx`: takes the organization's brand lock (held
 * until `tx` ends), re-checks the cap, and inserts the `active_version` row.
 * Throws the same 403 as `assertBrandCapacity` when the cap was reached in the
 * meantime, which rolls back everything the caller wrote in `tx`.
 */
export async function claimBrandSlot(
  tx: Tx,
  claim: BrandClaim,
  row: typeof activeVersion.$inferInsert,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`studio.brands:${claim.organizationId}`}, 0))`,
  )
  // A concurrent first publish of this same project may have created the brand
  // while we waited for the lock; counting it again would refuse our own brand.
  if (await isActive(tx, row.projectId)) return

  assertAllowed(claim, needsCount(claim) ? await countActiveBrands(tx, claim.organizationId) : 0)
  await tx.insert(activeVersion).values(row)
}

async function isActive(q: Db | Tx, projectId: string): Promise<boolean> {
  const [row] = await q
    .select({ projectId: activeVersion.projectId })
    .from(activeVersion)
    .where(eq(activeVersion.projectId, projectId))
    .limit(1)
  return Boolean(row)
}

function needsCount(claim: BrandClaim): boolean {
  return claim.hardCap && claim.entitlements?.limits['studio.brands'] !== undefined
}

function countActiveBrands(q: Db | Tx, organizationId: string): Promise<number> {
  return q.$count(
    activeVersion,
    inArray(
      activeVersion.projectId,
      q.select({ id: project.id }).from(project).where(eq(project.organizationId, organizationId)),
    ),
  )
}

function assertAllowed(claim: BrandClaim, activeBrands: number): void {
  const verdict: BrandQuotaVerdict = evaluateBrandQuota(
    claim.entitlements,
    activeBrands,
    claim.hardCap,
  )
  if (verdict.allowed) return

  if (verdict.reason === 'brand_quota_exceeded') recordQuotaDenial('studio.brands')
  throw createError({
    statusCode: 403,
    statusMessage:
      verdict.reason === 'brand_quota_exceeded'
        ? 'Active brand limit reached for this plan'
        : 'Organization is suspended',
    data: {
      code: verdict.reason,
      limit: verdict.reason === 'brand_quota_exceeded' ? verdict.limit : undefined,
      planKey: claim.entitlements?.planKey,
    },
  })
}
