import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// The route's own half: mode, origin, body. What the transfer decides and
// writes is measured in server/lib/ownership-transfer.pg.test.ts.

vi.mock('h3', () => mockH3())
const op = vi.fn()
vi.mock('~~/server/lib/org-membership', () => ({
  membershipDeps: async () => 'DEPS',
  transferOwnership: (...a: unknown[]) => op(...a),
}))
let mode = 'oidc'
vi.mock('~~/server/lib/oidc/config', () => ({ authMode: () => mode }))

const SAME_ORIGIN = {
  origin: 'https://studio.test',
  host: 'studio.test',
  'x-forwarded-proto': 'https',
}
const { default: handler } = await import('./ownership-transfer.post')
const call = (over: Parameters<typeof fakeEvent>[0] = {}) =>
  handler(
    fakeEvent({
      headers: SAME_ORIGIN,
      params: { orgId: 'org-1' },
      body: { userId: 'u-2' },
      context: { auth: { sub: 'u-1', tenant: 'org-1' } },
      ...over,
    }) as never,
  )

beforeEach(() => {
  mode = 'oidc'
  op.mockReset()
  op.mockResolvedValue({ ok: true })
})

describe('POST /api/orgs/:orgId/ownership-transfer', () => {
  it('passes the org, target and step-down role to the store', async () => {
    await call({ body: { userId: 'u-2', stepDownTo: 'member' } })
    expect(op).toHaveBeenCalledWith('DEPS', expect.anything(), 'org-1', 'u-2', 'member')
  })

  it('does not exist in better-auth mode', async () => {
    mode = 'better-auth'
    await expect(call()).rejects.toMatchObject({ statusCode: 404 })
    expect(op).not.toHaveBeenCalled()
  })

  it('refuses cross-origin, anonymous, and a step-down to owner', async () => {
    await expect(
      call({
        headers: { origin: 'https://evil.test', host: 'studio.test', 'x-forwarded-proto': 'https' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(call({ context: {} })).rejects.toMatchObject({ statusCode: 401 })
    await expect(call({ body: { userId: 'u-2', stepDownTo: 'owner' } })).rejects.toMatchObject({
      statusCode: 400,
    })
    await expect(call({ body: {} })).rejects.toMatchObject({ statusCode: 400 })
    expect(op).not.toHaveBeenCalled()
  })
})
