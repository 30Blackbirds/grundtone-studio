import { describe, expect, it } from 'vitest'
import * as client from '~~/composables/useOrgRoles'
import { ASSIGNABLE, canAssignRole, canManageMember, ORG_RANK } from './org-membership-input'

// The server's copy of the members page's role rules must give the same answer
// for every pair, or the page offers what the server refuses (or the reverse).
describe('org role rules: server and members page agree', () => {
  it('the same rank order', () => {
    expect(ORG_RANK).toEqual(client.ORG_ROLES)
  })

  it('the same assignable roles', () => {
    expect([...ASSIGNABLE].sort()).toEqual([...client.ASSIGNABLE_ORG_ROLES].sort())
  })

  const pairs = ORG_RANK.flatMap((a) => ORG_RANK.map((b) => [a, b] as const))
  it.each(pairs)('actor %s, target %s', (actor, target) => {
    expect(canAssignRole(actor, target)).toBe(client.canAssignRole(actor, target))
    expect(canManageMember(actor, target)).toBe(client.canManageMember(actor, target))
  })

  it('a manager cannot make anyone a manager, and cannot touch another manager', () => {
    expect(canAssignRole('manager', 'manager')).toBe(false)
    expect(canManageMember('manager', 'manager')).toBe(false)
    expect(canManageMember('owner', 'owner')).toBe(true)
  })
})
