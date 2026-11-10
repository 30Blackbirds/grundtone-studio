import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// The route's own half: who may call it, what it hands to the operation. What
// the operation writes (org_member, the audit row, the order against auth) is
// measured in server/lib/org-membership.pg.test.ts.

vi.mock('h3', () => mockH3())

const op = vi.fn()
vi.mock('~~/server/lib/org-membership', () => ({
  membershipDeps: async () => 'DEPS',
  removeMember: (...a: unknown[]) => op(...a),
}))

let orgRole: string | null = 'owner'
const requireOrgRole = vi.fn()
vi.mock('~~/server/lib/project-access', () => {
  const ORG_ROLES = ['billing', 'member', 'admin', 'manager', 'owner'] as const
  return {
    ORG_ROLES,
    requireOrgRole: (...a: unknown[]) => {
      requireOrgRole(...a)
      const min = a[2] as string
      if (!orgRole || ORG_ROLES.indexOf(orgRole as never) < ORG_ROLES.indexOf(min as never)) {
        throw Object.assign(new Error(`Requires org:${min}`), { statusCode: 403 })
      }
      return Promise.resolve({ userId: 'u-1', organizationId: a[1], role: orgRole })
    },
  }
})

const SAME_ORIGIN = { origin: 'https://studio.test', host: 'studio.test' }

const { default: handler } = await import('./[memberId].delete')

beforeEach(() => {
  op.mockReset()
  op.mockResolvedValue({ ok: true })
})

describe('DELETE /api/orgs/:orgId/memberships/:memberId', () => {
  it('hands the caller’s role and the member to the operation', async () => {
    const event = fakeEvent({
      headers: SAME_ORIGIN,
      params: { orgId: 'org-1', memberId: 'm-1' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await handler(event as never)
    expect(op).toHaveBeenCalledWith('DEPS', event, 'owner', 'org-1', 'm-1')
  })

  it('below org admin: 403, and the operation is never called', async () => {
    orgRole = 'member'
    await expect(
      handler(
        fakeEvent({
          headers: SAME_ORIGIN,
          params: { orgId: 'org-1', memberId: 'm-1' },
          context: { auth: { sub: 'u-1', tenant: 'org-1' } },
        }) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(op).not.toHaveBeenCalled()
    orgRole = 'owner'
  })

  // 🔴 Per route: a page on another origin is refused before anything runs.
  it('a cross-origin request is 403 cross_origin, and the operation is never called', async () => {
    const event = fakeEvent({
      headers: { origin: 'https://evil.test', host: 'studio.test' },
      params: { orgId: 'org-1', memberId: 'm-1' },
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
      params: { orgId: 'org-1', memberId: 'm-1' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await expect(handler(event as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(op).not.toHaveBeenCalled()
  })
})
