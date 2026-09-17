import { and, eq, gte, ilike, inArray, lt, or, type SQL } from 'drizzle-orm'
import { auditLog } from '~~/server/db/schema'

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
