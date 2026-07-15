import { describe, it, expect } from 'vitest'
import { canManageOrgMembers, findMemberForUser, isOrgOwner, parseOrgRole } from '~~/lib/org-role'

describe('findMemberForUser', () => {
  const members = [
    { userId: 'u1', role: 'owner' },
    { userId: 'u2', role: 'member' },
  ]

  it('returns the member matching the user id', () => {
    expect(findMemberForUser(members, 'u2')).toEqual({ userId: 'u2', role: 'member' })
  })

  it('returns null when the user is not a member', () => {
    expect(findMemberForUser(members, 'u3')).toBeNull()
  })

  it('returns null when members or userId are missing', () => {
    expect(findMemberForUser(undefined, 'u1')).toBeNull()
    expect(findMemberForUser(members, undefined)).toBeNull()
  })
})

describe('parseOrgRole', () => {
  it('accepts known org roles', () => {
    expect(parseOrgRole('owner')).toBe('owner')
    expect(parseOrgRole('manager')).toBe('manager')
    expect(parseOrgRole('billing')).toBe('billing')
  })

  it('rejects unknown roles', () => {
    expect(parseOrgRole('superadmin')).toBeNull()
    expect(parseOrgRole(undefined)).toBeNull()
  })
})

describe('route org role gates', () => {
  it('does not grant owner UI when the route org role is member', () => {
    const member = findMemberForUser(
      [
        { userId: 'u1', role: 'member' },
        { userId: 'u2', role: 'owner' },
      ],
      'u1',
    )
    const role = parseOrgRole(member?.role)
    expect(isOrgOwner(role)).toBe(false)
    expect(canManageOrgMembers(role)).toBe(false)
  })

  it('grants manager UI only for the route org role', () => {
    const member = findMemberForUser([{ userId: 'u1', role: 'manager' }], 'u1')
    const role = parseOrgRole(member?.role)
    expect(canManageOrgMembers(role)).toBe(true)
    expect(isOrgOwner(role)).toBe(false)
  })
})
