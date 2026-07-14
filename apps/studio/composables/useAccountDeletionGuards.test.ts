import { describe, it, expect, vi } from 'vitest'

vi.mock('~~/lib/auth-client', () => ({
  organization: {
    list: vi.fn(),
    getFullOrganization: vi.fn(),
  },
}))

import { isSoleOwnerOfOrg } from '~~/composables/useAccountDeletionGuards'

describe('isSoleOwnerOfOrg', () => {
  it('returns true when user is the only owner', () => {
    expect(
      isSoleOwnerOfOrg(
        [
          { userId: 'u1', role: 'owner' },
          { userId: 'u2', role: 'member' },
        ],
        'u1',
      ),
    ).toBe(true)
  })

  it('returns false when multiple owners exist', () => {
    expect(
      isSoleOwnerOfOrg(
        [
          { userId: 'u1', role: 'owner' },
          { userId: 'u2', role: 'owner' },
        ],
        'u1',
      ),
    ).toBe(false)
  })

  it('returns false when user is owner but not the only member with owner role', () => {
    expect(isSoleOwnerOfOrg([{ userId: 'u2', role: 'owner' }], 'u1')).toBe(false)
  })

  it('returns false when user is member only', () => {
    expect(
      isSoleOwnerOfOrg(
        [
          { userId: 'u1', role: 'member' },
          { userId: 'u2', role: 'owner' },
        ],
        'u1',
      ),
    ).toBe(false)
  })
})
