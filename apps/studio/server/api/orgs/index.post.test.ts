import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// The route's own half: who may call it, what it hands to the operation. What
// the operation writes (org_member, the audit row, the order against auth) is
// measured in server/lib/org-membership.pg.test.ts.

vi.mock('h3', () => mockH3())

const op = vi.fn()
vi.mock('~~/server/lib/org-membership', () => ({
  membershipDeps: async () => 'DEPS',
  createOrganization: (...a: unknown[]) => op(...a),
}))

const { default: handler } = await import('./index.post')

beforeEach(() => {
  op.mockReset()
  op.mockResolvedValue({ ok: true })
})

describe('POST /api/orgs', () => {
  it('creates as the caller and answers 201', async () => {
    const event = fakeEvent({
      body: { name: 'Acme', slug: 'acme' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await handler(event as never)
    expect(op).toHaveBeenCalledWith('DEPS', event, 'u-1', { name: 'Acme', slug: 'acme' })
    expect(event.responseStatus).toBe(201)
  })

  it('a bad slug is 400 and nothing is called', async () => {
    const event = fakeEvent({
      body: { name: 'Acme', slug: 'Not OK' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
    })
    await expect(handler(event as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(op).not.toHaveBeenCalled()
  })

  it('no actor is 401', async () => {
    await expect(handler(fakeEvent({ body: {}, context: {} }) as never)).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})
