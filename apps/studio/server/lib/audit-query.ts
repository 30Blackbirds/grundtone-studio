import { and, eq, gte, ilike, inArray, lt, or, type SQL } from 'drizzle-orm'
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
  before?: Date
  beforeId?: string
}

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
    // same timestamp with a smaller id. Without beforeId, plain `<`.
    const cursor = f.beforeId
      ? or(
          lt(auditLog.createdAt, f.before),
          and(eq(auditLog.createdAt, f.before), lt(auditLog.id, f.beforeId)),
        )
      : lt(auditLog.createdAt, f.before)
    if (cursor) conds.push(cursor)
  }
  return conds
}
