import { desc, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'

defineRouteMeta({
  openAPI: {
    summary: 'Lister versionshistorik + id på aktiv version.',
    description:
      "Returnerer projektets versionshistorik sammen med id'et på den aktuelt aktive version.",
    tags: ['Versions'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  await requireProjectAccess(event, projectId)

  const versions = await db
    .select({
      id: configVersion.id,
      version: configVersion.version,
      status: configVersion.status,
      publishedAt: configVersion.publishedAt,
      publishedBy: configVersion.publishedBy,
      publishedByEmail: configVersion.publishedByEmail,
      createdAt: configVersion.createdAt,
      // Full token payloads power the client-side version diff (R3b). Token
      // sets are small (~25 leaf values) and the caller already has viewer
      // access to every version's content via the config endpoint.
      tokensJson: configVersion.tokensJson,
    })
    .from(configVersion)
    .where(eq(configVersion.projectId, projectId))
    .orderBy(desc(configVersion.version))

  const [activePtr] = await db
    .select({ configVersionId: activeVersion.configVersionId })
    .from(activeVersion)
    .where(eq(activeVersion.projectId, projectId))

  return {
    versions,
    activeVersionId: activePtr?.configVersionId ?? null,
  }
})
