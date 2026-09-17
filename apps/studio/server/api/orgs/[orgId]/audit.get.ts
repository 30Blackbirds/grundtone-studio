import { and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~~/server/db'
import { auditLog } from '~~/server/db/schema'
import { AUDIT_ACTIONS } from '~~/server/lib/audit'
import { auditConditions } from '~~/server/lib/audit-query'
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

defineRouteMeta({
  openAPI: {
    summary:
      'Cursor-pagineret audit-log for org (kun manager/owner); filtrerbar på action, actor, fritekst (q) og periode (after).',
    description:
      'Returnerer en cursor-pagineret audit-log for en org. Kræver manager- eller owner-rolle og kan filtreres på action, actor, fritekst (q, over hele historikken) og periode (after).',
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
  const { action, actor, q, qActions, after, before, beforeId } = parsed.data

  const conds = auditConditions({
    orgId,
    action,
    actor,
    q,
    qActions,
    after: after ? new Date(after) : undefined,
    before: before ? new Date(before) : undefined,
    beforeId,
  })

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
