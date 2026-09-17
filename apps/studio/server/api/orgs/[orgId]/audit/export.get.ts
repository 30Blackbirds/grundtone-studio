import { and, desc } from 'drizzle-orm'
import { db } from '~~/server/db'
import { auditLog } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { auditConditions, auditFilterSchema } from '~~/server/lib/audit-query'
import { requireOrgRole } from '~~/server/lib/project-access'
import { auditCsv } from '~~/utils/audit-export'

// Upper bound for one export. Above it the request is REFUSED rather than
// truncated: a compliance export that silently stops at N rows looks complete
// and is not. The client asks the user to narrow the filter.
export const AUDIT_EXPORT_MAX_ROWS = 10_000

defineRouteMeta({
  openAPI: {
    summary: 'CSV-eksport af org-audit-log med samme filtre som listen (kun manager/owner).',
    description:
      'Eksporterer HELE den filtrerede historik (ikke kun indlæste rækker) som semikolon-separeret CSV. ' +
      'Afviser med 413 over AUDIT_EXPORT_MAX_ROWS i stedet for at afkorte. Selve eksporten registreres ' +
      'i audit-loggen (audit.exported) med filtre og rækkeantal.',
    tags: ['Org'],
  },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400 })

  // Same gate as the list: managers and owners only.
  await requireOrgRole(event, orgId, 'manager')

  const parsed = auditFilterSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }
  const { action, actor, q, qActions, after } = parsed.data

  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        ...auditConditions({
          orgId,
          action,
          actor,
          q,
          qActions,
          after: after ? new Date(after) : undefined,
        }),
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(AUDIT_EXPORT_MAX_ROWS + 1)

  if (rows.length > AUDIT_EXPORT_MAX_ROWS) {
    throw createError({
      statusCode: 413,
      statusMessage: `More than ${AUDIT_EXPORT_MAX_ROWS} events match; narrow the filter`,
    })
  }

  // Exporting the log is itself an accountable action.
  await recordAuditEvent(event, {
    organizationId: orgId,
    action: 'audit.exported',
    targetType: 'audit_log',
    targetLabel: `${rows.length} events`,
    after: { rowCount: rows.length, filters: { action, actor, q, qActions, after } },
  })

  const csv = auditCsv(
    rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      actorEmail: r.actorEmail,
      targetLabel: r.targetLabel,
      ipAddress: r.ipAddress,
    })),
  )

  const date = new Date().toISOString().slice(0, 10)
  setResponseHeaders(event, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="audit-${orgId}-${date}.csv"`,
    'Cache-Control': 'no-store',
  })
  return csv
})
