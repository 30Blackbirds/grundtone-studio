import { and, desc, eq, max } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion } from '~~/server/db/schema'
import { requireAdmin, requireProjectAccess } from '~~/server/lib/project-access'
import { paths, putObject } from '~~/server/lib/storage'
import { renderTokensCss } from '~~/server/lib/css-renderer'
import { tokensSchema, type Tokens } from '~~/server/lib/tokens'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId)
  requireAdmin(access.role)

  // Find draft (or accept tokens in body to publish-as-you-save)
  const [draft] = await db
    .select()
    .from(configVersion)
    .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'draft')))
    .orderBy(desc(configVersion.createdAt))
    .limit(1)

  if (!draft) {
    throw createError({ statusCode: 400, statusMessage: 'No draft to publish' })
  }

  const validated = tokensSchema.parse(draft.tokensJson)
  const tokens = validated as Tokens
  const json = JSON.stringify(tokens, null, 2)
  const css = renderTokensCss(tokens)

  // Compute next version number across the whole project
  const [{ value: maxVersion }] = await db
    .select({ value: max(configVersion.version) })
    .from(configVersion)
    .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'published')))
  const nextVersion = (maxVersion ?? 0) + 1

  const p = paths(projectId)

  // Upload immutable archive + overwrite "current" pointer files.
  // Long Cache-Control on versioned (immutable). Short Cache-Control on current
  // (CDN purges on publish; downstream clients revalidate often).
  await Promise.all([
    putObject(p.versionedJson(nextVersion), json, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
    }),
    putObject(p.versionedCss(nextVersion), css, {
      contentType: 'text/css',
      cacheControl: 'public, max-age=31536000, immutable',
    }),
    putObject(p.currentJson, json, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=60, must-revalidate',
    }),
    putObject(p.currentCss, css, {
      contentType: 'text/css',
      cacheControl: 'public, max-age=60, must-revalidate',
    }),
  ])

  // Promote draft → published version, update active pointer, in a single transaction
  const promoted = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(configVersion)
      .set({
        version: nextVersion,
        status: 'published',
        publishedAt: new Date(),
        publishedBy: access.userId,
      })
      .where(eq(configVersion.id, draft.id))
      .returning()

    await tx
      .insert(activeVersion)
      .values({
        projectId,
        configVersionId: updated.id,
        activatedBy: access.userId,
      })
      .onConflictDoUpdate({
        target: activeVersion.projectId,
        set: {
          configVersionId: updated.id,
          activatedAt: new Date(),
          activatedBy: access.userId,
        },
      })

    return updated
  })

  // TODO Phase 5: invalidate Bunny.net cache for /k/{anyKey}/* of this project

  return {
    version: promoted.version,
    publishedAt: promoted.publishedAt,
    paths: { json: p.currentJson, css: p.currentCss },
  }
})
