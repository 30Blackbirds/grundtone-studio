import { and, desc } from 'drizzle-orm'
import { db } from '~~/server/db'
import { auditLog } from '~~/server/db/schema'
import { resolveMachineActors } from '~~/server/lib/audit-actors'
import { auditConditions, auditFilterSchema } from '~~/server/lib/audit-query'
import { requireOrgRole } from '~~/server/lib/project-access'

const PAGE_SIZE = 50

// Cursor pagination on the composite key (created_at DESC, id DESC). Plain
// created_at would skip or duplicate rows whenever two events share the same
// millisecond — likely in bursty signup/publish flows. The cursor is the last
// seen (createdAt, id); the next page asks for rows strictly less than that
// tuple in the same ordering.

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

  const parsed = auditFilterSchema.safeParse(getQuery(event))
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
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  // A key acts as `machine:{keyId}` with no email; name it so the page does not
  // fall back to "System" for an action a key performed (KH-964, AC-G1).
  const keys = await resolveMachineActors(
    orgId,
    page.map((r) => r.actorUserId),
  )
  const items = page.map((r) => ({
    ...r,
    actorKey: (r.actorUserId && keys.get(r.actorUserId)) || null,
  }))
  const last = items[items.length - 1]
  const nextBefore = hasMore && last ? last.createdAt.toISOString() : null
  const nextBeforeId = hasMore && last ? last.id : null

  return { items, nextBefore, nextBeforeId }
})
