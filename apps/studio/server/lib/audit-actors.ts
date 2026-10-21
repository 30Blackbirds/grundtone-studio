import { and, eq, inArray, or, type SQL } from 'drizzle-orm'
import { apiKey, project } from '~~/server/db/schema'

// Names the KEY behind a machine actor on the audit page (KH-964, AC-G1).
//
// A key acts as `machine:{keyId}` with no email, so the row identifies the key
// but the page — which only knows members' names and emails — showed it as
// "System": an action that names nobody, which is exactly what AC-G1 forbids.

export interface MachineActorKey {
  keyPrefix: string
  keyType: string
}

const MACHINE_PREFIX = 'machine:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Distinct key ids behind `machine:{uuid}` actors; anything else is ignored. */
export function machineKeyIds(actorUserIds: readonly (string | null)[]): string[] {
  const ids = new Set<string>()
  for (const actor of actorUserIds) {
    if (!actor?.startsWith(MACHINE_PREFIX)) continue
    const id = actor.slice(MACHINE_PREFIX.length)
    if (UUID.test(id)) ids.add(id)
  }
  return [...ids]
}

/**
 * 🔴 SCOPED TO THE ORG, not just to the ids. A key is shown only if it belongs
 * to this org — directly (a provisioning key) or through one of its projects
 * (`pk_`/`sk_`). The ids come from this org's own audit rows, so an outside key
 * should never appear; the scope makes that a property of the query instead of
 * an assumption, so another org's key prefix cannot leak onto this page.
 */
export function machineActorScope(orgId: string, keyIds: string[]): SQL {
  return and(
    inArray(apiKey.id, keyIds),
    or(eq(apiKey.organizationId, orgId), eq(project.organizationId, orgId)),
  )!
}

export async function resolveMachineActors(
  orgId: string,
  actorUserIds: readonly (string | null)[],
): Promise<Map<string, MachineActorKey>> {
  const keyIds = machineKeyIds(actorUserIds)
  if (keyIds.length === 0) return new Map()

  const { db } = await import('~~/server/db')
  const rows = await db
    .select({ id: apiKey.id, keyPrefix: apiKey.keyPrefix, keyType: apiKey.keyType })
    .from(apiKey)
    .leftJoin(project, eq(apiKey.projectId, project.id))
    .where(machineActorScope(orgId, keyIds))

  return new Map(
    rows.map((r) => [`${MACHINE_PREFIX}${r.id}`, { keyPrefix: r.keyPrefix, keyType: r.keyType }]),
  )
}
