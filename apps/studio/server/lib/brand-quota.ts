import { createError } from 'h3'
import { eq, inArray } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, project } from '~~/server/db/schema'
import { PLAN_CATALOG } from '~~/lib/plan-catalog'
import { evaluateBrandQuota, getStudioEntitlements } from '~~/server/lib/entitlements'
import { recordQuotaDenial, recordQuotaFailOpen } from '~~/server/lib/metrics'

/**
 * Server-side enforcement of the active-brand cap (riff bfxmm7xktk6xkfanh5eennva).
 *
 * A project counts as a brand once it has an `active_version` row, and only two
 * routes write that row: publish and activate. Both call this BEFORE any DB or
 * storage write, so a refused call changes nothing.
 *
 * - Project already active → not a new brand → always allowed (republish and
 *   rollback at the cap keep working).
 * - Entitlements unavailable → fail-open (contract §4, quotas), counted.
 * - Plan not marked `hardCap` in the catalog, or unknown → allowed; overage
 *   plans are billed, not blocked.
 *
 * Known gap: the check and the later `active_version` write are not atomic, so
 * two concurrent first publishes in the same org can both pass at limit-1.
 */
export async function assertBrandCapacity(
  organizationId: string,
  projectId: string,
): Promise<void> {
  const [alreadyActive] = await db
    .select({ projectId: activeVersion.projectId })
    .from(activeVersion)
    .where(eq(activeVersion.projectId, projectId))
    .limit(1)
  if (alreadyActive) return

  const entitlements = await getStudioEntitlements(organizationId)
  if (entitlements === null && process.env.ACCOUNT_URL) {
    recordQuotaFailOpen('studio.brands', 'entitlements_unavailable')
  }

  const hardCap = PLAN_CATALOG.find((p) => p.key === entitlements?.planKey)?.hardCap ?? false
  const needsCount = hardCap && entitlements?.limits['studio.brands'] !== undefined
  const activeBrands = needsCount
    ? await db.$count(
        activeVersion,
        inArray(
          activeVersion.projectId,
          db
            .select({ id: project.id })
            .from(project)
            .where(eq(project.organizationId, organizationId)),
        ),
      )
    : 0

  const verdict = evaluateBrandQuota(entitlements, activeBrands, hardCap)
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
      planKey: entitlements?.planKey,
    },
  })
}
