import { and, desc, eq, max } from 'drizzle-orm'
import { db } from '~~/server/db'
import { configVersion } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { tokensSchema } from '~~/server/lib/tokens'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'editor')

  const parsed = tokensSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const [existing] = await db
    .select()
    .from(configVersion)
    .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'draft')))
    .orderBy(desc(configVersion.createdAt))
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(configVersion)
      .set({ tokensJson: parsed.data })
      .where(eq(configVersion.id, existing.id))
      .returning()
    return updated
  }

  const [{ value: maxVersion }] = await db
    .select({ value: max(configVersion.version) })
    .from(configVersion)
    .where(eq(configVersion.projectId, projectId))

  const [created] = await db
    .insert(configVersion)
    .values({
      projectId,
      version: (maxVersion ?? 0) + 1,
      tokensJson: parsed.data,
      status: 'draft',
      publishedBy: access.userId,
    })
    .returning()
  return created
})
