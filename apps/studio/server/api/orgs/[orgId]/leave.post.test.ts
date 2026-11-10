import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// The route's own half: who may call it, what it hands to the operation. What
// the operation writes (org_member, the audit row, the order against auth) is
// measured in server/lib/org-membership.pg.test.ts.

vi.mock('h3', () => mockH3())

const op = vi.fn()
vi.mock('~~/server/lib/org-membership', () => ({
  membershipDeps: async () => 'DEPS',
  leaveOrganization: (...a: unknown[]) => op(...a),
}))

const SAME_ORIGIN = { origin: 'https://studio.test', host: 'studio.test' }

const { default: handler } = await import('./leave.post')

beforeEach(() => {
  op.mockReset()
  op.mockResolvedValue({ ok: true })
})

describe('POST /api/orgs/:orgId/leave', () => {
  it('the caller leaves, and only the caller', async () => {
    const event = fakeEvent({
      headers: SAME_ORIGIN,
      params: { orgId: 'org-1' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await handler(event as never)
    expect(op).toHaveBeenCalledWith('DEPS', event, 'u-1', 'org-1')
  })

  it('no actor is 401', async () => {
    await expect(
      handler(
        fakeEvent({ headers: SAME_ORIGIN, params: { orgId: 'org-1' }, context: {} }) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(op).not.toHaveBeenCalled()
  })

  // 🔴 Per route: a page on another origin is refused before anything runs.
  it('a cross-origin request is 403 cross_origin, and the operation is never called', async () => {
    const event = fakeEvent({
      headers: { origin: 'https://evil.test', host: 'studio.test' },
      params: { orgId: 'org-1' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await expect(handler(event as never)).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'cross_origin' },
    })
    expect(op).not.toHaveBeenCalled()
  })

  it('no Origin at all is refused too', async () => {
    const event = fakeEvent({
      headers: { host: 'studio.test' },
      params: { orgId: 'org-1' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await expect(handler(event as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(op).not.toHaveBeenCalled()
  })
})
