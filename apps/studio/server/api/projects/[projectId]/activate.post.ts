import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { purgeProjectCdn } from '~~/server/lib/bunny'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { paths, putObject, getObjectAsString } from '~~/server/lib/storage'
import { renderTokensCss } from '~~/server/lib/css-renderer'

const bodySchema = z.object({ versionId: z.uuid() })

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'editor')

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const [version] = await db
    .select()
    .from(configVersion)
    .where(
      and(
        eq(configVersion.id, parsed.data.versionId),
        eq(configVersion.projectId, projectId),
        eq(configVersion.status, 'published'),
      ),
    )
  if (!version) {
    throw createError({ statusCode: 404, statusMessage: 'Published version not found' })
  }

  // Rebuild "current" pointer files from the historical version's tokens.
  // Avoids re-reading from storage when the JSON is already in the DB row.
  const p = paths(projectId)
  const tokens = version.tokensJson
  const json = JSON.stringify(tokens, null, 2)

  // Try to reuse the previously rendered CSS; fall back to re-rendering.
  let css = await getObjectAsString(p.versionedCss(version.version))
  if (!css) css = renderTokensCss(tokens)

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

  await db
    .insert(activeVersion)
    .values({
      projectId,
      configVersionId: version.id,
      activatedBy: access.userId,
      activatedByEmail: event.context.auth?.email ?? null,
    })
    .onConflictDoUpdate({
      target: activeVersion.projectId,
      set: {
        configVersionId: version.id,
        activatedAt: new Date(),
        activatedBy: access.userId,
        activatedByEmail: event.context.auth?.email ?? null,
      },
    })

  // Same rationale as publish: purge the CDN so the rolled-back tokens are
  // served immediately rather than after the 60s max-age expires. Dispatched
  // via `void` so the activate response doesn't wait on the network RTT.
  void purgeProjectCdn(projectId).catch((err) =>
    console.warn(`[activate] background purge crashed: ${(err as Error)?.message ?? String(err)}`),
  )

  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'config.activated',
    targetType: 'project',
    targetId: projectId,
    targetLabel: access.project.name,
    after: { version: version.version },
  })

  return { version: version.version, activatedAt: new Date() }
})
