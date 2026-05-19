// Sentry-style 5-tier org roles. Single source of truth for the client side;
// must stay in sync with server/lib/project-access.ts (OrgRole + ORG_ROLE_RANK).

export type OrgRole = 'billing' | 'member' | 'admin' | 'manager' | 'owner'

export const ORG_ROLES: readonly OrgRole[] = ['billing', 'member', 'admin', 'manager', 'owner']

// Roles that can be set via Better Auth's updateMemberRole / inviteMember.
// Owner is excluded — promoting to owner requires a separate transfer flow
// (Better Auth doesn't expose it through updateMemberRole). Keep the picker
// in sync with what the server actually accepts.
export type AssignableOrgRole = Exclude<OrgRole, 'owner'>
export const ASSIGNABLE_ORG_ROLES: readonly AssignableOrgRole[] = [
  'billing',
  'member',
  'admin',
  'manager',
]

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  billing: 0,
  member: 1,
  admin: 2,
  manager: 3,
  owner: 4,
}

export function isOrgRole(value: string | undefined | null): value is OrgRole {
  return (
    value === 'billing' ||
    value === 'member' ||
    value === 'admin' ||
    value === 'manager' ||
    value === 'owner'
  )
}

// Hierarchical rule, mirrors Sentry: you may assign or change to a role no
// higher than your own. You cannot demote or remove a peer (same rank) unless
// you're the owner — owners are the only ones who can change other owners.
export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  if (actor === 'owner') return true
  return ORG_ROLE_RANK[actor] > ORG_ROLE_RANK[target]
}

export function canManageMember(actor: OrgRole, targetCurrent: OrgRole): boolean {
  if (actor === 'owner') return true
  return ORG_ROLE_RANK[actor] > ORG_ROLE_RANK[targetCurrent]
}
