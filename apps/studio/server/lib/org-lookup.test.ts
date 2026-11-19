import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Where the org-served hook fires: only after the auth service returned an org
// for the caller's own cookie. A miss, a missing cookie and an auth error must
// not fire it, or the hosted service would announce orgs nobody uses.

const mode = vi.hoisted(() => ({ value: 'better-auth' as 'better-auth' | 'oidc' }))
vi.mock('./oidc/config', () => ({ authMode: () => mode.value }))
vi.mock('./dev-auth-bypass', () => ({
  DEV_BYPASS_ORG: { id: 'dev-org', name: 'Dev', slug: 'dev' },
  DEV_BYPASS_USER: { id: 'dev-user' },
  devAuthBypassEnabled: () => false,
}))

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const { lookupOrgBySlug } = await import('./org-lookup')
const { onOrgServed } = await import('./org-hooks')

const flush = () => new Promise((r) => setTimeout(r, 0))
const withCookie = { node: { req: { headers: { cookie: 'session=1' } } }, context: {} }
const noCookie = { node: { req: { headers: {} } }, context: {} }
const ev = (e: object) => e as unknown as H3Event

const served = vi.fn()
let off: () => void = () => {}

beforeEach(() => {
  process.env.AUTH_ISSUER = 'http://auth.test'
  mode.value = 'better-auth'
  off = onOrgServed(served)
})
afterEach(() => {
  off()
  served.mockClear()
  fetchMock.mockReset()
})

describe('org lookup fires the org-served hook', () => {
  it('fires with the org the auth service returned', async () => {
    const org = { id: 'o1', name: 'Acme', slug: 'acme', createdAt: '2026-11-01T00:00:00.000Z' }
    fetchMock.mockResolvedValue(org)
    await expect(lookupOrgBySlug(ev(withCookie), 'acme')).resolves.toEqual(org)
    await flush()
    expect(served).toHaveBeenCalledWith(org)
  })

  it('does not fire when the org is not found', async () => {
    fetchMock.mockResolvedValue(null)
    await expect(lookupOrgBySlug(ev(withCookie), 'nope')).resolves.toBeNull()
    fetchMock.mockRejectedValue(Object.assign(new Error('x'), { status: 404 }))
    await expect(lookupOrgBySlug(ev(withCookie), 'nope')).resolves.toBeNull()
    await flush()
    expect(served).not.toHaveBeenCalled()
  })

  it('does not fire without a cookie, and never calls auth then', async () => {
    await expect(lookupOrgBySlug(ev(noCookie), 'acme')).resolves.toBeNull()
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(served).not.toHaveBeenCalled()
  })

  it('does not fire when auth fails', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 502 }))
    await expect(lookupOrgBySlug(ev(withCookie), 'acme')).rejects.toThrow('boom')
    await flush()
    expect(served).not.toHaveBeenCalled()
  })
})
