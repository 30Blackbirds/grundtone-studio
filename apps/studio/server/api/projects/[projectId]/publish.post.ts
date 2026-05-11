import { and, desc, eq, max } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion } from '~~/server/db/schema'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { paths, putObject } from '~~/server/lib/storage'
import { renderTokensCss } from '~~/server/lib/css-renderer'
import { tokensSchema, type Tokens } from '~~/server/lib/tokens'

// Publish ordering — four phases, each recoverable if the next one fails.
//
//   A. Promote draft → published in DB. Reserves the version number even
//      if subsequent steps fail, so the next publish picks N+1 (no path
//      collision in immutable storage).
//   B. Upload versioned archive blobs (immutable, long-cache).
//   C. Overwrite current.* pointer blobs (what customers' CDN reads).
//   D. Flip active_version pointer (what Studio's UI reads).
//
// Failure between phases leaves an "orphaned" published row + no pointer
// update; customers keep seeing the previous version on the CDN. A periodic
// reaper can drop status='published' rows with no active_version reference.

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'editor')

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

  const [{ value: maxVersion }] = await db
    .select({ value: max(configVersion.version) })
    .from(configVersion)
    .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'published')))
  const nextVersion = (maxVersion ?? 0) + 1

  const p = paths(projectId)

  // ─── Phase A — promote draft → published, reserving the version number ──
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
    return updated
  })

  // ─── Phase B — upload immutable archive blobs ───────────────────────────
  await Promise.all([
    putObject(p.versionedJson(nextVersion), json, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
    }),
    putObject(p.versionedCss(nextVersion), css, {
      contentType: 'text/css',
      cacheControl: 'public, max-age=31536000, immutable',
    }),
  ])

  // ─── Phase C — overwrite "current" pointer blobs (what the CDN reads) ───
  // Must happen before active_version flips: customers and Studio UI stay
  // in sync, never the other way around (UI says new active, CDN serves old).
  await Promise.all([
    putObject(p.currentJson, json, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=60, must-revalidate',
    }),
    putObject(p.currentCss, css, {
      contentType: 'text/css',
      cacheControl: 'public, max-age=60, must-revalidate',
    }),
  ])

  // ─── Phase D — flip active_version pointer (atomic in DB) ───────────────
  await db
    .insert(activeVersion)
    .values({
      projectId,
      configVersionId: promoted.id,
      activatedBy: access.userId,
    })
    .onConflictDoUpdate({
      target: activeVersion.projectId,
      set: {
        configVersionId: promoted.id,
        activatedAt: new Date(),
        activatedBy: access.userId,
      },
    })

  // TODO #56: invalidate Bunny.net cache for /k/{anyKey}/* of this project

  return {
    version: promoted.version,
    publishedAt: promoted.publishedAt,
    paths: { json: p.currentJson, css: p.currentCss },
  }
})
