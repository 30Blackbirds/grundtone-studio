import { afterEach, describe, expect, it, vi } from 'vitest'

const reportBrandCount = vi.fn().mockResolvedValue({ kind: 'applied' })
vi.mock('~~/server/lib/brand-count', () => ({
  reportBrandCount: (id: string) => reportBrandCount(id),
}))

let boot: () => void = () => {}
vi.stubGlobal('defineNitroPlugin', (fn: () => void) => {
  boot = fn
  return fn
})

const { notifyBrandCountChanged } = await import('~~/server/lib/brand-hooks')
await import('./brand-count-billing')

afterEach(() => reportBrandCount.mockClear())

// Without this wiring, billing would silently stop hearing about new brands.
describe('brand-count billing plugin', () => {
  it('reports the org to billing when the brand count changes', async () => {
    boot()
    notifyBrandCountChanged('org-7')
    await new Promise((r) => setTimeout(r, 0))
    expect(reportBrandCount).toHaveBeenCalledWith('org-7')
  })
})
