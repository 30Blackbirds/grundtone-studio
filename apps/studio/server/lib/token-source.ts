import { and, desc, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, configVersion } from '~~/server/db/schema'
import type { Tokens } from '~~/server/lib/tokens'

export type TokenSource = 'draft' | 'active'

/**
 * The token set of a project's current draft or active version, or null when
 * the project has none. Same rows config.get returns to the editor.
 */
export async function loadTokenSource(
  projectId: string,
  source: TokenSource,
): Promise<{ version: number; tokens: Tokens } | null> {
  if (source === 'draft') {
    const [draft] = await db
      .select()
      .from(configVersion)
      .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'draft')))
      .orderBy(desc(configVersion.createdAt))
      .limit(1)
    return draft ? { version: draft.version, tokens: draft.tokensJson as Tokens } : null
  }
  const [pointer] = await db
    .select()
    .from(activeVersion)
    .where(eq(activeVersion.projectId, projectId))
  if (!pointer) return null
  const [active] = await db
    .select()
    .from(configVersion)
    .where(eq(configVersion.id, pointer.configVersionId))
  return active ? { version: active.version, tokens: active.tokensJson as Tokens } : null
}
