import { createError, defineEventHandler, getRouterParam } from 'h3'
import { and, desc, eq, inArray, isNull, max, notInArray } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion, fontLicenceAttestation } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { assertBrandCapacity, claimBrandSlot } from '~~/server/lib/brand-quota'
import { notifyBrandCountChanged } from '~~/server/lib/brand-hooks'
import { purgeProjectCdn } from '~~/server/lib/bunny'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { copyObject, paths, putObject } from '~~/server/lib/storage'
import { renderTokensCss } from '~~/server/lib/css-renderer'
import { referencedAssets } from '~~/server/lib/asset-upload'
import { curatedFontFiles, readCuratedFont } from '~~/server/lib/curated-fonts'
import { tokensSchema, type Tokens } from '~~/server/lib/tokens'

// Publish ordering — four phases, each recoverable if the next one fails.
//
//   A. Promote draft → published in DB. Reserves the version number even
//      if subsequent steps fail, so the next publish picks N+1 (no path
//      collision in immutable storage). For a project's FIRST version this
//      transaction also creates the brand (claimBrandSlot): the cap is
//      re-checked under a per-organization lock and the active_version row is
//      written here, so a refused publish rolls back with nothing reserved.
//   B. Upload versioned archive blobs (immutable, long-cache).
//   C. Overwrite current.* pointer blobs (what customers' CDN reads).
//   D. Flip active_version pointer (what Studio's UI reads).
//
// Failure between phases leaves an "orphaned" published row + no pointer
// update; customers keep seeing the previous version on the CDN. A periodic
// reaper can drop status='published' rows with no active_version reference.
// The one exception is a first version: its pointer already exists after A,
// so if B or C fail the brand counts against the cap with nothing on the CDN
// until the next publish succeeds. That is the price of never letting two
// concurrent first publishes share one remaining brand slot.

defineRouteMeta({
  openAPI: {
    summary:
      'Publicerer draft → ny version (DB → versioned blobs → current blobs → active-pointer → CDN-purge); kræver editor.',
    description:
      'Publicerer den aktuelle draft som en ny version: reserverer version i DB, skriver versioned blobs, overskriver current blobs, flytter active-pointer og purger CDN. Kræver editor.',
    tags: ['Publishing'],
  },
})

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

  // Active-brand cap: a project's first publish creates a brand. This unlocked
  // check refuses early; Phase A repeats it under the lock (null = already a brand).
  const brandClaim = await assertBrandCapacity(access.organization.id, projectId)

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
        publishedByEmail: event.context.auth?.email ?? null,
      })
      .where(eq(configVersion.id, draft.id))
      .returning()
    if (brandClaim) {
      await claimBrandSlot(tx, brandClaim, {
        projectId,
        configVersionId: updated.id,
        activatedBy: access.userId,
        activatedByEmail: event.context.auth?.email ?? null,
      })
    }
    return updated
  })

  // A new brand changes the org's brand count. Listeners (see brand-hooks.ts)
  // are told but not awaited: the publish never waits on them.
  if (brandClaim) notifyBrandCountChanged(access.organization.id)

  // ─── Phase B — upload immutable archive blobs ───────────────────────────
  const assets = referencedAssets(tokens)
  // Kuraterede fonte: de VALGTE vægte læses fra @fontsource-pakkerne på disk
  // og skrives ind i projektets eget fonts/-præfiks, så kurateret og custom
  // serveres uniformt via /k og CSS'ens relative url()'er bare virker.
  const slots = tokens.typography?.slots
  const curated = (
    await Promise.all(
      (['heading', 'body'] as const).map(async (slotKey) => {
        const slot = slots?.[slotKey]
        if (slot?.source !== 'curated') return []
        return Promise.all(
          curatedFontFiles(slot.family, slot.weights, slotKey).map(async (f) => ({
            name: f.name,
            body: await readCuratedFont(slot.family, f.weight),
          })),
        )
      }),
    )
  ).flat()
  await Promise.all([
    putObject(p.versionedJson(nextVersion), json, {
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
    }),
    putObject(p.versionedCss(nextVersion), css, {
      contentType: 'text/css',
      cacheControl: 'public, max-age=31536000, immutable',
    }),
    // Brand-assets promoveres fra draft-laget i samme fase — server-side copy,
    // binærerne rundtures aldrig gennem app-processen. Mangler en refereret
    // draft-blob (uploadet slettet/aldrig lagt), fejler copy → publish fejler
    // FØR current/-pointerne røres, så kunder aldrig ser en halv version.
    ...assets.map((a) =>
      copyObject(p.draftAsset(a.name), p.versionedAsset(nextVersion, a.name), {
        contentType: a.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      }),
    ),
    ...curated.map((f) =>
      putObject(p.versionedAsset(nextVersion, f.name), f.body, {
        contentType: 'font/woff2',
        cacheControl: 'public, max-age=31536000, immutable',
      }),
    ),
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
    ...assets.map((a) =>
      copyObject(p.versionedAsset(nextVersion, a.name), p.currentAsset(a.name), {
        contentType: a.contentType,
        cacheControl: 'public, max-age=60, must-revalidate',
      }),
    ),
    ...curated.map((f) =>
      copyObject(p.versionedAsset(nextVersion, f.name), p.currentAsset(f.name), {
        contentType: 'font/woff2',
        cacheControl: 'public, max-age=60, must-revalidate',
      }),
    ),
  ])

  // ─── Retention-uret (jura §16a) ─────────────────────────────────────────
  // Fase C har netop skiftet hvad /k serverer, så DETTE er øjeblikket hvor
  // leverancen af de gamle filer ophører og de nye begynder. Ét felt bærer
  // begge retninger: filer der ikke længere er refereret får uret startet,
  // og filer der er tilbage (rollback til en tidligere font) får det ryddet.
  // Vi rører kun rækker hvis tilstand faktisk ændrer sig — isNull/notNull i
  // where-klausulerne gør begge opdateringer idempotente, så en gentaget
  // publish uden font-ændringer ikke forskyder uret.
  const servedFiles = [...assets.map((a) => a.name), ...curated.map((f) => f.name)].filter((n) =>
    n.startsWith('fonts/'),
  )
  const now = new Date()
  if (servedFiles.length > 0) {
    // Genoptaget levering → nulstil uret.
    await db
      .update(fontLicenceAttestation)
      .set({ servingEndedAt: null })
      .where(
        and(
          eq(fontLicenceAttestation.projectId, projectId),
          inArray(fontLicenceAttestation.file, servedFiles),
        ),
      )
    // Alt andet i projektet serveres ikke længere → start uret (kun hvis det
    // ikke allerede løber, ellers ville hver publish udskyde sletningen).
    await db
      .update(fontLicenceAttestation)
      .set({ servingEndedAt: now })
      .where(
        and(
          eq(fontLicenceAttestation.projectId, projectId),
          isNull(fontLicenceAttestation.servingEndedAt),
          notInArray(fontLicenceAttestation.file, servedFiles),
        ),
      )
  } else {
    // Ingen custom/kuraterede fontfiler i den nye version → alt ophører.
    await db
      .update(fontLicenceAttestation)
      .set({ servingEndedAt: now })
      .where(
        and(
          eq(fontLicenceAttestation.projectId, projectId),
          isNull(fontLicenceAttestation.servingEndedAt),
        ),
      )
  }

  // ─── Phase D — flip active_version pointer (atomic in DB) ───────────────
  await db
    .insert(activeVersion)
    .values({
      projectId,
      configVersionId: promoted.id,
      activatedBy: access.userId,
      activatedByEmail: event.context.auth?.email ?? null,
    })
    .onConflictDoUpdate({
      target: activeVersion.projectId,
      set: {
        configVersionId: promoted.id,
        activatedAt: new Date(),
        activatedBy: access.userId,
        activatedByEmail: event.context.auth?.email ?? null,
      },
    })

  // ─── Phase E — purge Bunny.net edge cache so customers see new tokens ───
  // Truly fire-and-forget: dispatched via `void` so the publish response
  // doesn't wait on the network RTT to Bunny. purgeProjectCdn handles its
  // own errors internally; the .catch here is a final safety net. CDN
  // converges within max-age=60 even if the purge silently fails.
  void purgeProjectCdn(projectId).catch((err) =>
    console.warn(`[publish] background purge crashed: ${(err as Error)?.message ?? String(err)}`),
  )

  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'config.published',
    targetType: 'project',
    targetId: projectId,
    targetLabel: access.project.name,
    after: { version: promoted.version },
  })

  return {
    version: promoted.version,
    publishedAt: promoted.publishedAt,
    paths: { json: p.currentJson, css: p.currentCss },
  }
})
