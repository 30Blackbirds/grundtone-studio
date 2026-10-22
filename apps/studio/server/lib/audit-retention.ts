import { and, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { auditLog } from '~~/server/db/schema'

// Retention for audit_log (Allan 2026-10-10, written down by [jura] in
// docs/legal/revisionslog-eksport-vurdering.md §7.3, served in the privacy
// policy's retention table):
//
//   - ip_address and user_agent: at most 90 days, then removed from the row;
//   - the row itself: 12 months from the action, then deleted.
//
// 🔴 THE CUT IS THE DEADLINE MINUS THE RUN INTERVAL, not the deadline. A job
// that runs every N and removes "older than F" lets a value live up to F + N
// ([jura]'s rule). This runs hourly (nuxt.config.ts `scheduledTasks`) and cuts
// one DAY early, so the deadlines still hold if up to 23 runs in a row are
// missed (a restart, a deploy, a crashed container). Both periods share the
// hourly schedule because hourly is frequent enough for both; they are still
// two separate statements with two separate cut-offs.
export const IP_UA_MAX_DAYS = 90
export const ROW_MAX_MONTHS = 12
export const SAFETY_MARGIN_DAYS = 1

const DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionCutoffs {
  /** Rows created before this lose ip_address and user_agent. */
  stripBefore: Date
  /** Rows created before this are deleted. */
  deleteBefore: Date
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  const stripBefore = new Date(now.getTime() - (IP_UA_MAX_DAYS - SAFETY_MARGIN_DAYS) * DAY_MS)
  const deleteBefore = new Date(now.getTime())
  deleteBefore.setUTCMonth(deleteBefore.getUTCMonth() - ROW_MAX_MONTHS)
  deleteBefore.setTime(deleteBefore.getTime() + SAFETY_MARGIN_DAYS * DAY_MS)
  return { stripBefore, deleteBefore }
}

/** Rows that still carry an IP or user agent past the strip cut-off. */
export function stripCondition(cut: Date): SQL {
  return and(
    lt(auditLog.createdAt, cut),
    or(isNotNull(auditLog.ipAddress), isNotNull(auditLog.userAgent)),
  )!
}

export function deleteCondition(cut: Date): SQL {
  return lt(auditLog.createdAt, cut)
}

export interface RetentionResult {
  ranAt: string
  stripBefore: string
  deleteBefore: string
  stripped: number
  deleted: number
}

/**
 * Applies both rules and returns what it did. Deletes first, so rows about to
 * go are not rewritten for nothing. Throws on a database error — the caller
 * (the scheduled task) must surface a failed run, not swallow it, because a
 * silent failure here is a broken legal promise nobody sees.
 */
export async function applyAuditRetention(now: Date = new Date()): Promise<RetentionResult> {
  const { db } = await import('~~/server/db')
  const { stripBefore, deleteBefore } = retentionCutoffs(now)

  const deleted = await db
    .delete(auditLog)
    .where(deleteCondition(deleteBefore))
    .returning({ id: auditLog.id })

  const stripped = await db
    .update(auditLog)
    .set({ ipAddress: null, userAgent: null })
    .where(stripCondition(stripBefore))
    .returning({ id: auditLog.id })

  return {
    ranAt: now.toISOString(),
    stripBefore: stripBefore.toISOString(),
    deleteBefore: deleteBefore.toISOString(),
    stripped: stripped.length,
    deleted: deleted.length,
  }
}

// Exported for the measurement the acceptance criterion names: the oldest row
// that still carries an IP/UA, and the oldest row at all, in days.
export async function retentionAges(): Promise<{
  maxAgeWithIpUaDays: number | null
  maxAgeDays: number | null
}> {
  const { db } = await import('~~/server/db')
  const [row] = await db
    .select({
      withIpUa: sql<
        number | null
      >`extract(epoch from max(now() - ${auditLog.createdAt}) filter (where ${auditLog.ipAddress} is not null or ${auditLog.userAgent} is not null)) / 86400`,
      any: sql<number | null>`extract(epoch from max(now() - ${auditLog.createdAt})) / 86400`,
    })
    .from(auditLog)
  return {
    maxAgeWithIpUaDays: row?.withIpUa == null ? null : Number(row.withIpUa),
    maxAgeDays: row?.any == null ? null : Number(row.any),
  }
}
