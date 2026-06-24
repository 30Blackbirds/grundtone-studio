import { desc, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'

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
