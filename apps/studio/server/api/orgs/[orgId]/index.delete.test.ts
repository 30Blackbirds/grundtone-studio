import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// The route's own half: who may call it, what it hands to the operation. What
// the operation writes (org_member, the audit row, the order against auth) is
// measured in server/lib/org-membership.pg.test.ts.

vi.mock('h3', () => mockH3())

const op = vi.fn()
vi.mock('~~/server/lib/org-membership', () => ({
  membershipDeps: async () => 'DEPS',
  deleteOrganization: (...a: unknown[]) => op(...a),
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

const { default: handler } = await import('./index.delete')

beforeEach(() => {
  op.mockReset()
  op.mockResolvedValue({ ok: true })
})

describe('DELETE /api/orgs/:orgId', () => {
  it('an owner deletes the org named in the path', async () => {
    const event = fakeEvent({
      params: { orgId: 'org-1' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await handler(event as never)
    expect(requireOrgRole).toHaveBeenCalledWith(event, 'org-1', 'owner')
    expect(op).toHaveBeenCalledWith('DEPS', event, 'org-1')
  })

  it('below org owner: 403, and the operation is never called', async () => {
    orgRole = 'manager'
    await expect(
      handler(
        fakeEvent({
          params: { orgId: 'org-1' },
          context: { auth: { sub: 'u-1', tenant: 'org-1' } },
        }) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(op).not.toHaveBeenCalled()
    orgRole = 'owner'
  })
})
