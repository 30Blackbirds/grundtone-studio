export type OrgRole = 'billing' | 'member' | 'admin' | 'manager' | 'owner'

/** Resolve the current user's membership in a specific org (route slug), not the session active org. */
export function findMemberForUser<T extends { userId: string }>(
  members: readonly T[] | undefined,
  userId: string | undefined,
): T | null {
  if (!members || !userId) return null
  return members.find((m) => m.userId === userId) ?? null
}

export function parseOrgRole(role: string | undefined): OrgRole | null {
  return role === 'billing' ||
    role === 'member' ||
    role === 'admin' ||
    role === 'manager' ||
    role === 'owner'
    ? role
    : null
}

export function canManageOrgMembers(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'manager'
}

export function isOrgOwner(role: OrgRole | null): boolean {
  return role === 'owner'
}

export function canManageBilling(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'billing'
}

export function canCreateProjects(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'manager' || role === 'admin'
}

export function canViewProjects(role: OrgRole | null): boolean {
  return Boolean(role) && role !== 'billing'
}
