import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, auditLog, configVersion, project } from '~~/server/db/schema'
import { assembleDashboard } from '~~/server/lib/dashboard'
import { listCallerOrgs, lookupOrgById } from '~~/server/lib/org-lookup'

const ACTIVITY_LIMIT = 8

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
        .where(inArray(auditLog.organizationId, auditableOrgIds))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(ACTIVITY_LIMIT)
    : []

  return assembleDashboard(orgs, projects, activeRows, draftRows, activityRows)
})
