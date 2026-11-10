import { createError } from 'h3'
import type { z } from 'zod'
import type { OrgRole } from './project-access'

// The role rules the members page applies (composables/useOrgRoles.ts), applied
// again on the server. The page hides what an actor may not do; until now
// nothing on studio's side refused it, and whether auth refuses it is not
// measured. org-membership-input.test.ts holds the two copies equal.

/** Roles that can be given by invitation or role change; owner is a transfer. */
export const ASSIGNABLE = ['billing', 'member', 'admin', 'manager'] as const

// Rank order, lowest first, as project-access.ts's ORG_ROLES. A local copy
// because project-access.ts loads the database, and these rules must not.
export const ORG_RANK: readonly OrgRole[] = ['billing', 'member', 'admin', 'manager', 'owner']

const rank = (role: OrgRole) => ORG_RANK.indexOf(role)

/** An actor may give only a role below its own; an owner may give any. */
export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  return actor === 'owner' || rank(actor) > rank(target)
}

/** An actor may change or remove only a member below its own rank; an owner, anyone. */
export function canManageMember(actor: OrgRole, targetCurrent: OrgRole): boolean {
  return actor === 'owner' || rank(actor) > rank(targetCurrent)
}

/** A body that does not match is the caller's error (400), not the server's. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Invalid body',
    })
  }
  return parsed.data
}
