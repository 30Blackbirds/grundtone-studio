import { describe, expect, it, vi } from 'vitest'

const ensureTenantProvisioned = vi.fn().mockResolvedValue(undefined)
vi.mock('~~/server/lib/tenant-outbox', () => ({
  ensureTenantProvisioned: (org: unknown) => ensureTenantProvisioned(org),
}))

let boot: () => void = () => {}
vi.stubGlobal('defineNitroPlugin', (fn: () => void) => {
  boot = fn
  return fn
})

const { notifyOrgServed } = await import('~~/server/lib/org-hooks')
await import('./tenant-outbox-hook')

// Without this wiring, account would silently stop hearing about new tenants.
describe('tenant-outbox plugin', () => {
  it('queues the announcement when an org is served', async () => {
    boot()
    const org = { id: 'org-9', slug: 'acme', createdAt: '2026-11-01T00:00:00.000Z' }
    notifyOrgServed(org)
    await new Promise((r) => setTimeout(r, 0))
    expect(ensureTenantProvisioned).toHaveBeenCalledWith(org)
  })
})
