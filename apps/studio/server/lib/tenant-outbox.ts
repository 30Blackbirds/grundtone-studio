import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, lte, min, sql } from 'drizzle-orm'
// Relative imports, not `~~`: the backfill (server/db/backfill-tenant-
// provisioned.ts) runs this module under plain `node --import tsx` in the
// image, where Nuxt's path aliases do not exist.
import { db } from '../db'
import { auditLog, project, tenantEventOutbox } from '../db/schema'
import { PORTAL_KEY } from './entitlements'

// Studio's producer side of the eventcontract (platform
// packages/eventcontract, `AccountIngestService.Publish`, at-least-once).
//
// WHY STUDIO PUBLISHES `tenantProvisioned` AT FIRST USE, NOT AT ORG CREATION:
// orgs are created in the central auth service, which is shared by every
// portal and cannot tell a Studio org from any other. Studio only learns an org
// exists when it serves it. "This org is a grundtone-studio tenant" is
// therefore made true by Studio having served it — which is also what gives
// account its grant source (a membership on THIS portal) for the checkout gate.
//
// 🔴 `provisionedAt` IS ALWAYS SENT, and it errs EARLY. Account picks the plan
// from it (contract §3): before the portal's cutover ⇒ studio-legacy
// (unlimited), after ⇒ studio-free. An org that existed before Studio's
// producer went live must never be dropped to free limits by the event that
// merely announces it, so the time is the EARLIEST evidence we have of the org:
// auth's createdAt, its first project, its first audit row. "Now" is used only
// when there is no evidence at all, i.e. for an org that is genuinely new.

/** Connect unary-JSON path for `AccountIngestService.Publish`. */
export const PUBLISH_PATH = '/klanghaus.platform.eventcontract.v1.AccountIngestService/Publish'

const BATCH = 25
const LEASE_MS = 2 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000

export interface ProvisionableOrg {
  id: string
  /** Unknown to the backfill, which has no user session to ask auth with. */
  slug?: string
  /** auth's organization.createdAt, when the lookup returned it. */
  createdAt?: string | Date | null
}

/** The proto-JSON `Event` (eventcontract v1) for a provisioned tenant. */
export function buildTenantProvisioned(
  idempotencyKey: string,
  org: { id: string; slug?: string },
  provisionedAt: Date,
  occurredAt: Date,
): Record<string, unknown> {
  return {
    idempotencyKey,
    occurredAt: occurredAt.toISOString(),
    // Enum values travel as their proto NAMES. A TS enum member would
    // serialise as a number, and 0 is PRODUCER_UNSPECIFIED (etude#45).
    producer: 'PRODUCER_GRUNDTONE_STUDIO',
    tenantProvisioned: {
      // Account names the company after the slug, else the tenant id.
      tenant: { tenantId: org.id, ...(org.slug ? { slug: org.slug } : {}), portalKey: PORTAL_KEY },
      // Studio is sold as subscriptions; the free tier is a subscription at 0.
      paymentModel: 'PAYMENT_MODEL_SUBSCRIPTION',
      provisionedAt: provisionedAt.toISOString(),
    },
  }
}

function validDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The earliest of the given times, or `fallback` when none is valid. */
export function earliest(
  candidates: Array<string | Date | null | undefined>,
  fallback: Date,
): Date {
  const times = candidates.map(validDate).filter((d): d is Date => d !== null)
  if (times.length === 0) return fallback
  return new Date(Math.min(...times.map((d) => d.getTime())))
}

/**
 * Every org Studio has SERVED — the backfill's population. Only tables Studio
 * itself writes on a member's or a provisioning key's action: `project` and
 * `audit_log` (every audit writer is a Studio request handler).
 *
 * 🔴 NOT `org_suspension` ([sikkerhed], studio#367 re-issue 2026-10-28): account
 * writes that row (TenantLifecycleCallbackService), so counting it would make
 * account's own state the grant source for account's billing gate — circular.
 * And reactivation deletes the row, so a present row means "suspended now":
 * the union would have announced currently suspended orgs as tenants.
 */
export async function knownOrgIds(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT organization_id AS id FROM ${project}
    UNION SELECT organization_id FROM ${auditLog}
  `)
  return [...rows].map((r) => r.id).sort()
}

/** Studio's own earliest trace of an org: its first project and first audit row. */
export async function studioEvidence(orgId: string): Promise<Date[]> {
  const [p] = await db
    .select({ at: min(project.createdAt) })
    .from(project)
    .where(eq(project.organizationId, orgId))
  const [a] = await db
    .select({ at: min(auditLog.createdAt) })
    .from(auditLog)
    .where(eq(auditLog.organizationId, orgId))
  return [p?.at, a?.at].filter((d): d is Date => d instanceof Date)
}

/**
 * Queues `tenantProvisioned` for an org unless one already exists. Returns
 * true when this call created the row.
 */
export async function enqueueTenantProvisioned(
  org: ProvisionableOrg,
  now: Date = new Date(),
): Promise<boolean> {
  const provisionedAt = earliest([org.createdAt, ...(await studioEvidence(org.id))], now)
  const id = randomUUID()
  const inserted = await db
    .insert(tenantEventOutbox)
    .values({
      id,
      eventType: 'tenantProvisioned',
      organizationId: org.id,
      event: buildTenantProvisioned(id, org, provisionedAt, now),
    })
    .onConflictDoNothing()
    .returning({ id: tenantEventOutbox.id })
  return inserted.length > 0
}

// Orgs this process has already queued (or found queued). Saves the db round
// trip on every request; a restart only costs one no-op insert per org.
const known = new Set<string>()

/**
 * First-use hook: make sure the org is announced to account. Never throws —
 * an org lookup must not fail because the outbox could not be written; the
 * next request tries again because the org is only remembered on success.
 */
export async function ensureTenantProvisioned(org: ProvisionableOrg): Promise<void> {
  if (known.has(org.id)) return
  try {
    await enqueueTenantProvisioned(org)
    known.add(org.id)
  } catch (err) {
    console.error(`[tenant-outbox] could not queue tenantProvisioned for org ${org.id}:`, err)
  }
}

/** Test seam: forget which orgs this process has seen. */
export function resetKnownOrgs(): void {
  known.clear()
}

export type DeliveryOutcome =
  | { kind: 'delivered'; duplicate: boolean }
  | { kind: 'retry'; error: string }
  | { kind: 'park'; error: string }

/**
 * How one Publish answer is handled. Account's route (account
 * src/ingest/connect-routes.ts) defines the meaning:
 *   200 accepted/duplicate → done · 400 → malformed, permanent → park ·
 *   501 → account lacks the applier, keep it → retry · 401/503/5xx → retry.
 */
export function classifyPublishResponse(status: number, body: unknown): DeliveryOutcome {
  if (status === 200) {
    const b = (body ?? {}) as { accepted?: unknown; duplicate?: unknown }
    if (b.accepted === true || b.duplicate === true) {
      return { kind: 'delivered', duplicate: b.duplicate === true }
    }
    // A 200 that neither accepts nor recognises the event is not a delivery.
    return { kind: 'retry', error: `200 without accepted/duplicate: ${JSON.stringify(body)}` }
  }
  const detail = `${status}: ${JSON.stringify(body)}`
  if (status === 400) return { kind: 'park', error: detail }
  return { kind: 'retry', error: detail }
}

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** Math.max(0, attempts - 1))
}

interface IngestTarget {
  url: string
  token: string
}

/** Both are needed; without either the outbox only queues (dormant). */
function ingestTarget(): IngestTarget | null {
  const url = process.env.ACCOUNT_URL
  const token = process.env.ACCOUNT_INGEST_TOKEN
  if (!url || !token) return null
  return { url, token }
}

async function publish(
  target: IngestTarget,
  event: Record<string, unknown>,
): Promise<DeliveryOutcome> {
  let res: Response
  try {
    res = await fetch(`${target.url}${PUBLISH_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.token}` },
      body: JSON.stringify({ event }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    return { kind: 'retry', error: `transport: ${(err as Error).message}` }
  }
  const body = await res.json().catch(() => null)
  return classifyPublishResponse(res.status, body)
}

export interface DeliveryResult {
  dormant: boolean
  delivered: number
  retried: number
  parked: number
}

/**
 * Delivers due rows, oldest first. A row is leased (next_attempt_at pushed out)
 * in the same statement that claims it, so two replicas or an overlapping
 * checkout never send the same row at once; a crash mid-send just lets the
 * lease run out and the row is sent again, which account dedups.
 */
export async function deliverDue(
  opts: { organizationId?: string; now?: Date } = {},
): Promise<DeliveryResult> {
  const result: DeliveryResult = { dormant: false, delivered: 0, retried: 0, parked: 0 }
  const target = ingestTarget()
  if (!target) return { ...result, dormant: true }
  const now = opts.now ?? new Date()

  const due = and(
    isNull(tenantEventOutbox.deliveredAt),
    isNull(tenantEventOutbox.parkedAt),
    lte(tenantEventOutbox.nextAttemptAt, now),
    opts.organizationId ? eq(tenantEventOutbox.organizationId, opts.organizationId) : undefined,
  )
  const claimable = db
    .select({ id: tenantEventOutbox.id })
    .from(tenantEventOutbox)
    .where(due)
    .orderBy(tenantEventOutbox.createdAt)
    .limit(BATCH)
    .for('update', { skipLocked: true })
  const rows = await db
    .update(tenantEventOutbox)
    .set({
      attempts: sql`${tenantEventOutbox.attempts} + 1`,
      nextAttemptAt: new Date(now.getTime() + LEASE_MS),
    })
    .where(inArray(tenantEventOutbox.id, claimable))
    .returning()

  for (const row of rows) {
    const outcome = await publish(target, row.event)
    if (outcome.kind === 'delivered') {
      await db
        .update(tenantEventOutbox)
        .set({ deliveredAt: new Date(), lastError: null })
        .where(eq(tenantEventOutbox.id, row.id))
      result.delivered++
    } else if (outcome.kind === 'park') {
      await db
        .update(tenantEventOutbox)
        .set({ parkedAt: new Date(), lastError: outcome.error })
        .where(eq(tenantEventOutbox.id, row.id))
      console.error(
        `[tenant-outbox] account rejected ${row.id} as malformed; parked:`,
        outcome.error,
      )
      result.parked++
    } else {
      await db
        .update(tenantEventOutbox)
        .set({
          lastError: outcome.error,
          nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)),
        })
        .where(eq(tenantEventOutbox.id, row.id))
      result.retried++
    }
  }
  return result
}

/** Whether account has acknowledged this org's `tenantProvisioned`. */
export async function isTenantProvisioned(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ deliveredAt: tenantEventOutbox.deliveredAt })
    .from(tenantEventOutbox)
    .where(
      and(
        eq(tenantEventOutbox.organizationId, organizationId),
        eq(tenantEventOutbox.eventType, 'tenantProvisioned'),
      ),
    )
  return row?.deliveredAt != null
}

/**
 * Checkout's precondition: account answers `404 unknown_tenant` for an org it
 * has no company for (account#179), so the announcement must have landed
 * BEFORE the mint — the scheduled task is not fast enough for a first click.
 * Queues, delivers this org's rows now, and reports whether it landed.
 */
export async function provisionNow(org: ProvisionableOrg): Promise<boolean> {
  if (await isTenantProvisioned(org.id)) return true
  await enqueueTenantProvisioned(org)
  known.add(org.id)
  await deliverDue({ organizationId: org.id })
  return isTenantProvisioned(org.id)
}
