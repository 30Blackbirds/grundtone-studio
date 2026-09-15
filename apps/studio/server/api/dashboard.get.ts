import { and, desc, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, auditLog, configVersion, project } from '~~/server/db/schema'
import type { AuditAction } from '~~/server/lib/audit'
import { assembleDashboard } from '~~/server/lib/dashboard'
import { listCallerOrgs, lookupOrgById } from '~~/server/lib/org-lookup'

const ACTIVITY_LIMIT = 8

// Actions kept out of the dashboard's short activity feed. Draft saves (riff
// m2axh5obv4ce5a0hr4hm2xvk) and asset uploads (riff mfhvuk8515gubxh30puab9ch)
// are high-frequency editing steps: they are audited and stay visible on the
// audit page, but one row per step would push publishes and member changes out
// of an 8-row feed. Filtered in SQL so the limit still returns 8 meaningful rows.
export const FEED_EXCLUDED_ACTIONS: readonly AuditAction[] = [
  'config.draft_saved',
  'asset.font_uploaded',
  'asset.logo_uploaded',
]

defineRouteMeta({
  openAPI: {
    summary: 'Dashboard-aggregat: kalderens orgs, projekter m/ publish-status, seneste aktivitet.',
    description:
      'Samler dashboardets data i ét kald: alle kalderens organisationer (m/ medlemstal og egen ' +
      'rolle), alle projekter på tværs af dem med publish-status og primærfarve fra den aktive ' +
      'version, og seneste audit-aktivitet for de orgs hvor kalderen er manager/owner (spejler ' +
      'audit-loggens adgangsregel).',
    tags: ['Dashboard'],
  },
})

export default defineEventHandler(async (event) => {
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const orgList = await listCallerOrgs(event)
  if (orgList.length === 0) return { orgs: [], projects: [], activity: [] }

  // Member counts + the caller's own role come from the full-org payload.
  // One auth call per org — org counts are small (beachhead scale), and the
  // full-org lookup is already membership-scoped server-side.
  const fullOrgs = await Promise.all(orgList.map((o) => lookupOrgById(event, o.id)))
  const orgs = orgList.map((o, i) => {
    const full = fullOrgs[i]
    const role = full?.members?.find((m) => m.userId === actor.sub)?.role ?? null
    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      memberCount: full?.members?.length ?? null,
      role,
    }
  })

  const orgIds = orgs.map((o) => o.id)
  const projects = await db
    .select({
      id: project.id,
      organizationId: project.organizationId,
      slug: project.slug,
      name: project.name,
    })
    .from(project)
    .where(inArray(project.organizationId, orgIds))

  const projectIds = projects.map((p) => p.id)
  const [activeRows, draftRows] = projectIds.length
    ? await Promise.all([
        db
          .select({
            projectId: activeVersion.projectId,
            publishedAt: configVersion.publishedAt,
            tokensJson: configVersion.tokensJson,
          })
          .from(activeVersion)
          .innerJoin(configVersion, eq(activeVersion.configVersionId, configVersion.id))
          .where(inArray(activeVersion.projectId, projectIds)),
        db
          .select({ projectId: configVersion.projectId })
          .from(configVersion)
          .where(
            and(inArray(configVersion.projectId, projectIds), eq(configVersion.status, 'draft')),
          ),
      ])
    : [[], []]

  // Activity mirrors the audit-log access rule: manager/owner only.
  const auditableOrgIds = orgs
    .filter((o) => o.role === 'manager' || o.role === 'owner')
    .map((o) => o.id)
  const activityRows = auditableOrgIds.length
    ? await db
        .select({
          id: auditLog.id,
          organizationId: auditLog.organizationId,
          action: auditLog.action,
          actorEmail: auditLog.actorEmail,
          targetLabel: auditLog.targetLabel,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(
          and(
            inArray(auditLog.organizationId, auditableOrgIds),
            notInArray(auditLog.action, [...FEED_EXCLUDED_ACTIONS]),
          ),
        )
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(ACTIVITY_LIMIT)
    : []

  return assembleDashboard(orgs, projects, activeRows, draftRows, activityRows)
})
