import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~~/server/db'
import { auditLog } from '~~/server/db/schema'
import { AUDIT_ACTIONS } from '~~/server/lib/audit'
import { requireOrgRole } from '~~/server/lib/project-access'

const PAGE_SIZE = 50

// Cursor pagination on (created_at, id). The client passes the last seen
// row's createdAt as `before` to fetch older rows. Newest-first.
const querySchema = z.object({
  action: z
    .string()
    .optional()
    .refine((v) => !v || (AUDIT_ACTIONS as readonly string[]).includes(v), 'unknown action'),
  actor: z.string().optional(),
  before: z.iso.datetime().optional(),
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
  const { action, actor, before } = parsed.data

  const conds = [eq(auditLog.organizationId, orgId)]
  if (action) conds.push(eq(auditLog.action, action))
  if (actor) conds.push(eq(auditLog.actorUserId, actor))
  if (before) conds.push(lt(auditLog.createdAt, new Date(before)))

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_SIZE + 1)

  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextBefore = hasMore ? items[items.length - 1].createdAt.toISOString() : null

  return { items, nextBefore }
})
