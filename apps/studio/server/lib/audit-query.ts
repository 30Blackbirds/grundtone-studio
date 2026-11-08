import { and, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { auditLog } from '~~/server/db/schema'
import { AUDIT_ACTIONS } from '~~/server/lib/audit'

// Query parameters shared by the audit list and its export, so both apply
// exactly the same filters.
export const auditFilterSchema = z.object({
  action: z
    .string()
    .optional()
    .refine((v) => !v || (AUDIT_ACTIONS as readonly string[]).includes(v), 'unknown action'),
  actor: z.string().optional(),
  // Free-text search over the whole history (UX-audit finding 13: searching
  // only loaded rows made "no hits" look like "never happened").
  q: z.string().max(200).optional(),
  // Actions whose label in the viewer's locale matches q, comma-separated.
  qActions: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .refine(
      (list) => list.every((a) => (AUDIT_ACTIONS as readonly string[]).includes(a)),
      'unknown action in qActions',
    ),
  after: z.iso.datetime().optional(),
  before: z.iso.datetime().optional(),
  beforeId: z.uuid().optional(),
})

export interface AuditFilters {
  orgId: string
  action?: string
  actor?: string
  /** Free text, searched server-side over the WHOLE history, not loaded rows. */
  q?: string
  /** Actions whose translated label matches `q` (labels live in the client's locale). */
  qActions?: readonly string[]
  /** Lower bound for the period filter. */
  after?: Date
  /**
   * Cursor timestamp as ISO text, compared in Postgres. Not a Date: created_at
   * keeps microseconds and a Date keeps milliseconds (see auditCursorAt).
   */
  before?: string
  beforeId?: string
}

/**
 * created_at as ISO text with all six fractional digits, for the next-page
 * cursor (ClickUp 1amk32fn4t1). The column defaults to now(), which keeps
 * microseconds; `createdAt.toISOString()` cut the cursor to milliseconds, so
 * the `created_at = cursor` branch matched nothing and every row sharing the
 * last row's millisecond but younger than it was skipped. Measured on
 * postgres:16 before this change: page 2 lost 2 of 3 rows in one millisecond.
 */
export const auditCursorAt = sql<string>`to_char(${auditLog.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** Escapes LIKE wildcards so user input matches literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function auditConditions(f: AuditFilters): SQL[] {
  const conds: SQL[] = [eq(auditLog.organizationId, f.orgId)]
  if (f.action) conds.push(eq(auditLog.action, f.action))
  if (f.actor) conds.push(eq(auditLog.actorUserId, f.actor))
  if (f.after) conds.push(gte(auditLog.createdAt, f.after))

  const q = f.q?.trim()
  if (q) {
    const pattern = `%${escapeLike(q)}%`
    const matches: SQL[] = [
      ilike(auditLog.actorEmail, pattern),
      ilike(auditLog.targetLabel, pattern),
      ilike(auditLog.action, pattern),
      ilike(auditLog.ipAddress, pattern),
    ]
    if (f.qActions?.length) matches.push(inArray(auditLog.action, [...f.qActions]))
    const any = or(...matches)
    if (any) conds.push(any)
  }

  if (f.before) {
    // Composite cursor on (created_at DESC, id DESC): strictly older, or the
    // same timestamp with a smaller id. Without beforeId, plain `<`. The cast
    // happens in Postgres so the cursor keeps its microseconds.
    const before = sql`${f.before}::timestamptz`
    const cursor = f.beforeId
      ? or(
          sql`${auditLog.createdAt} < ${before}`,
          and(sql`${auditLog.createdAt} = ${before}`, lt(auditLog.id, f.beforeId)),
        )
      : sql`${auditLog.createdAt} < ${before}`
    if (cursor) conds.push(cursor)
  }
  return conds
}
