import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { and, desc, eq, max } from 'drizzle-orm'
import { db } from '~~/server/db'
import { configVersion } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { tokensSchema } from '~~/server/lib/tokens'
import { diffTokens } from '~~/utils/token-diff'

// Audit payload cap: a draft save can touch many tokens, and the audit row
// should say WHICH paths changed, never their values (riff m2axh5obv4ce5a0hr4hm2xvk).
const MAX_AUDITED_PATHS = 50

defineRouteMeta({
  openAPI: {
    summary: 'Gemmer tokens som draft-version (upsert af eksisterende draft); kræver editor.',
    description:
      "Gemmer tokens som draft config-version og upsert'er en eksisterende draft, hvis der findes en. Kræver editor.",
    tags: ['Config'],
  },
})

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
    await auditDraftSaved(event, access, projectId, {
      version: updated.version,
      created: false,
      previous: existing.tokensJson as Record<string, unknown>,
      next: parsed.data,
    })
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
  await auditDraftSaved(event, access, projectId, {
    version: created.version,
    created: true,
    previous: {},
    next: parsed.data,
  })
  return created
})

/**
 * Written only after the draft row is stored, so a rejected save (400 invalid
 * tokens, 403 role) never produces an event. The actor comes from the request:
 * a user session or `machine:{keyId}` for the token CLI.
 */
async function auditDraftSaved(
  event: Parameters<typeof recordAuditEvent>[0],
  access: { organization: { id: string }; project: { name: string } },
  projectId: string,
  change: {
    version: number
    created: boolean
    previous: Record<string, unknown>
    next: Record<string, unknown>
  },
) {
  const paths = diffTokens(change.previous, change.next).map((c) => c.path)
  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'config.draft_saved',
    targetType: 'project',
    targetId: projectId,
    targetLabel: access.project.name,
    after: {
      version: change.version,
      created: change.created,
      changedPathCount: paths.length,
      changedPaths: paths.slice(0, MAX_AUDITED_PATHS),
    },
  })
}
