import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// The route's own half: who may call it, what it hands to the operation. What
// the operation writes (org_member, the audit row, the order against auth) is
// measured in server/lib/org-membership.pg.test.ts.

vi.mock('h3', () => mockH3())

const op = vi.fn()
vi.mock('~~/server/lib/org-membership', () => ({
  membershipDeps: async () => 'DEPS',
  acceptInvitation: (...a: unknown[]) => op(...a),
}))

const { default: handler } = await import('./accept.post')

beforeEach(() => {
  op.mockReset()
  op.mockResolvedValue({ ok: true })
})

describe('POST /api/org-invitations/:invitationId/accept', () => {
  it('accepts for the caller; the role comes from auth, so the body is not read', async () => {
    const event = fakeEvent({
      params: { invitationId: 'inv-1' },
      body: { role: 'owner' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await handler(event as never)
    expect(op).toHaveBeenCalledWith('DEPS', event, 'u-1', 'inv-1')
  })

  it('no actor is 401', async () => {
    await expect(
      handler(fakeEvent({ params: { invitationId: 'inv-1' }, context: {} }) as never),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
