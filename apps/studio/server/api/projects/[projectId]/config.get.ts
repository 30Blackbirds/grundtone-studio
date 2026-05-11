import { and, desc, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { DEFAULT_TOKENS, type Tokens } from '~~/server/lib/tokens'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  await requireProjectAccess(event, projectId)

  const [draft] = await db
    .select()
    .from(configVersion)
    .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'draft')))
    .orderBy(desc(configVersion.createdAt))
    .limit(1)

  const [activePtr] = await db
    .select()
    .from(activeVersion)
    .where(eq(activeVersion.projectId, projectId))

  const active = activePtr
    ? (
        await db.select().from(configVersion).where(eq(configVersion.id, activePtr.configVersionId))
      )[0]
    : null

  return {
    draft: draft
      ? { id: draft.id, version: draft.version, tokens: draft.tokensJson as Tokens }
      : null,
    active: active
      ? {
          id: active.id,
          version: active.version,
          tokens: active.tokensJson as Tokens,
          publishedAt: active.publishedAt,
        }
      : null,
    defaults: DEFAULT_TOKENS,
  }
})
