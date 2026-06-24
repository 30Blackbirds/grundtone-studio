import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~~/server/db'
import { auditLog } from '~~/server/db/schema'
import { AUDIT_ACTIONS } from '~~/server/lib/audit'
import { requireOrgRole } from '~~/server/lib/project-access'

const PAGE_SIZE = 50

// Cursor pagination on the composite key (created_at DESC, id DESC). Plain
// created_at would skip or duplicate rows whenever two events share the same
// millisecond — likely in bursty signup/publish flows. The cursor is the last
// seen (createdAt, id); the next page asks for rows strictly less than that
// tuple in the same ordering.
const querySchema = z.object({
  action: z
    .string()
    .optional()
    .refine((v) => !v || (AUDIT_ACTIONS as readonly string[]).includes(v), 'unknown action'),
  actor: z.string().optional(),
  before: z.iso.datetime().optional(),
  beforeId: z.uuid().optional(),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Cursor-pagineret audit-log for org (kun manager/owner); filtrerbar på action og actor.',
    description:
      'Returnerer en cursor-pagineret audit-log for en org. Kræver manager- eller owner-rolle og kan filtreres på action og actor.',
    tags: ['Org'],
  },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400 })

  // Manager and owner can audit; admins below them cannot. Mirrors Sentry's
  // "only managers/owners can see member-management history".
  await requireOrgRole(event, orgId, 'manager')

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }
  const { action, actor, before, beforeId } = parsed.data

  const conds: SQL[] = [eq(auditLog.organizationId, orgId)]
  if (action) conds.push(eq(auditLog.action, action))
  if (actor) conds.push(eq(auditLog.actorUserId, actor))
  if (before) {
    const cutoff = new Date(before)
    // Composite cursor: strictly older OR same-timestamp-but-smaller-id.
    // beforeId is required to disambiguate ties; if the client omits it we
    // fall back to plain `<` (first-page-with-only-timestamp scenario).
    const cursor = beforeId
      ? or(
          lt(auditLog.createdAt, cutoff),
          and(eq(auditLog.createdAt, cutoff), lt(auditLog.id, beforeId)),
        )
      : lt(auditLog.createdAt, cutoff)
    if (cursor) conds.push(cursor)
  }

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(PAGE_SIZE + 1)

  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const last = items[items.length - 1]
  const nextBefore = hasMore && last ? last.createdAt.toISOString() : null
  const nextBeforeId = hasMore && last ? last.id : null

  return { items, nextBefore, nextBeforeId }
})
