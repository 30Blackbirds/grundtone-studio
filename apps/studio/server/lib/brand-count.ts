import { sql } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, project } from '~~/server/db/schema'
import { countActiveBrands } from './brand-quota'
import { PORTAL_KEY } from './entitlements'
import { billingEnabled } from './runtime-flags'

// Tells account how many active brands an org has, so Stripe bills the
// overage Studio shows (Allan 2026-10-27: «ingen skjulte ting … fuld
// transparency»; proration from the same day). Account owns the price shape
// and the arithmetic: Studio sends the COUNT, account sets the extra-brand
// item to max(0, count − included).
//
// The call is a SET, not an event: `PUT /v1/billing/{org}/brand-count` with
// the count and the moment it was read. Account refuses a reading older than
// the one it already applied (409 stale), so two reports that cross on the
// wire cannot leave the older number billed. A missed call is repaired by the
// daily reconcile task (server/tasks/billing/brand-count-reconcile.ts).
//
// Never throws: a brand that was created must not fail its publish because
// billing could not be told. The reconcile catches up.

export type BrandCountOutcome =
  | {
      kind: 'applied'
      activeBrands: number
      billedExtraBrands: number | null
      /** The count account held before this PUT; null when it had none or did not say. */
      previousActiveBrands: number | null
    }
  | { kind: 'stale' }
  | { kind: 'no_subscription' }
  | { kind: 'dormant' }
  /** FEATURE_BILLING=off: there is no billing to report to. */
  | { kind: 'billing_off' }
  | { kind: 'failed'; error: string }

/**
 * How account's answer is read. Account's HTTP errors are `{ error, message }`
 * (account src/http/errors.ts) — `error`, not `code`; measured against
 * account#182's route, where a `code` reader classed every 404/409 as a
 * failure. 🔴 A 404 counts as "no subscription" ONLY with account's own code: a 404 without it is a missing route (an account that
 * does not serve brand-count yet), and reading that as "nothing to bill" would
 * hide every failed report.
 */
export function classifyBrandCountResponse(status: number, body: unknown): BrandCountOutcome {
  const b = (body ?? {}) as {
    error?: unknown
    activeBrands?: unknown
    billedExtraBrands?: unknown
    previousActiveBrands?: unknown
  }
  if (status === 200 && typeof b.activeBrands === 'number') {
    return {
      kind: 'applied',
      activeBrands: b.activeBrands,
      billedExtraBrands: typeof b.billedExtraBrands === 'number' ? b.billedExtraBrands : null,
      previousActiveBrands:
        typeof b.previousActiveBrands === 'number' ? b.previousActiveBrands : null,
    }
  }
  if (status === 409 && b.error === 'stale') return { kind: 'stale' }
  if (status === 404 && b.error === 'no_subscription') return { kind: 'no_subscription' }
  return { kind: 'failed', error: `${status}: ${JSON.stringify(body)}` }
}

/** The org's active brands right now (checkout sends it with the mint). */
export function currentBrandCount(organizationId: string): Promise<number> {
  return countActiveBrands(db, organizationId)
}

/** Reads the org's active brands now and sets that number on account. */
export async function reportBrandCount(organizationId: string): Promise<BrandCountOutcome> {
  // Checked before ACCOUNT_URL: with billing off, a configured account URL is
  // still not a reason to send it brand counts.
  if (!billingEnabled()) return { kind: 'billing_off' }
  const accountUrl = process.env.ACCOUNT_URL
  if (!accountUrl) return { kind: 'dormant' }
  try {
    // asOf is taken BEFORE the count, so a count read later always carries a
    // later asOf — the ordering account's stale check relies on.
    const asOf = new Date()
    const activeBrands = await countActiveBrands(db, organizationId)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const token = process.env.ACCOUNT_S2S_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(
      `${accountUrl}/v1/billing/${encodeURIComponent(organizationId)}/brand-count`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ portalKey: PORTAL_KEY, activeBrands, asOf: asOf.toISOString() }),
        signal: AbortSignal.timeout(5_000),
      },
    )
    const outcome = classifyBrandCountResponse(res.status, await res.json().catch(() => null))
    if (outcome.kind === 'failed') {
      console.error(`[brand-count] org ${organizationId}: account did not take it:`, outcome.error)
    }
    return outcome
  } catch (err) {
    console.error(`[brand-count] org ${organizationId}: report failed:`, err)
    return { kind: 'failed', error: (err as Error).message }
  }
}

/** Every org with at least one active brand — the reconcile's population. */
export async function orgsWithBrands(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: project.organizationId })
    .from(project)
    .innerJoin(activeVersion, sql`${activeVersion.projectId} = ${project.id}`)
  return rows.map((r) => r.id).sort()
}
