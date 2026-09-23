import { and, desc, eq, max } from 'drizzle-orm'
import { db } from '~~/server/db'
import { configVersion } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import type { Tokens } from '~~/server/lib/tokens'
import { diffTokens } from '~~/utils/token-diff'

// The ONE way a draft is written (riff KH-1044 I3). Both the config editor and
// the DTCG import go through here, so "saved as draft" means the same thing and
// produces the same audit event whichever door it came in by. Extracted from
// config.post.ts when import needed the same path; duplicating it would have
// made a second definition of "draft" that drifts.

// Audit payload cap: a draft save can touch many tokens, and the audit row
// should say WHICH paths changed, never their values (riff m2axh5obv4ce5a0hr4hm2xvk).
const MAX_AUDITED_PATHS = 50

/** Where the draft came from. Absent for the ordinary editor save. */
export type DraftSource = 'dtcg-import'

export interface DraftAccess {
  organization: { id: string }
  project: { name: string }
  userId: string
}

/**
 * Upsert the project's draft and write the audit event. Nothing is published:
 * a draft is a draft whoever saved it.
 */
export async function saveDraft(
  event: Parameters<typeof recordAuditEvent>[0],
  access: DraftAccess,
  projectId: string,
  tokens: Tokens,
  options: { source?: DraftSource } = {},
) {
  const [existing] = await db
    .select()
    .from(configVersion)
    .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'draft')))
    .orderBy(desc(configVersion.createdAt))
    .limit(1)

  const row = existing
    ? (
        await db
          .update(configVersion)
          .set({ tokensJson: tokens })
          .where(eq(configVersion.id, existing.id))
          .returning()
      )[0]!
    : await insertDraft(projectId, tokens, access.userId)

  await audit(event, access, projectId, {
    version: row.version,
    created: !existing,
    previous: (existing?.tokensJson as Record<string, unknown>) ?? {},
    next: tokens,
    ...(options.source ? { source: options.source } : {}),
  })
  return row
}

async function insertDraft(projectId: string, tokens: Tokens, userId: string) {
  const [{ value: maxVersion }] = await db
    .select({ value: max(configVersion.version) })
    .from(configVersion)
    .where(eq(configVersion.projectId, projectId))

  const [created] = await db
    .insert(configVersion)
    .values({
      projectId,
      version: (maxVersion ?? 0) + 1,
      tokensJson: tokens,
      status: 'draft',
      publishedBy: userId,
    })
    .returning()
  return created!
}

/**
 * Written only after the draft row is stored, so a rejected save (400 invalid
 * tokens, 403 role) never produces an event. The actor comes from the request:
 * a user session or `machine:{keyId}` for the token CLI.
 */
async function audit(
  event: Parameters<typeof recordAuditEvent>[0],
  access: DraftAccess,
  projectId: string,
  change: {
    version: number
    created: boolean
    previous: Record<string, unknown>
    next: Record<string, unknown>
    source?: DraftSource
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
      ...(change.source ? { source: change.source } : {}),
    },
  })
}
