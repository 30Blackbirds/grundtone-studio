import { describe, expect, it, vi } from 'vitest'

// The reconcile re-sends every org's count; one org's failure must not stop
// the rest, and the run reports what happened per outcome.
const reportBrandCount = vi.fn()
vi.mock('~~/server/lib/brand-count', () => ({
  orgsWithBrands: () => Promise.resolve(['a', 'b', 'c']),
  reportBrandCount: (id: string) => reportBrandCount(id),
}))
vi.stubGlobal('defineTask', (t: unknown) => t)

const task = (await import('./brand-count-reconcile')).default as unknown as {
  meta: { name: string }
  run: () => Promise<{ result: Record<string, number> }>
}

describe('billing:brand-count-reconcile', () => {
  it('is registered under the name nuxt.config schedules', () => {
    expect(task.meta.name).toBe('billing:brand-count-reconcile')
  })

  it('reports every org and tallies the outcomes, carrying on past a failure', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    reportBrandCount
      .mockResolvedValueOnce({ kind: 'applied' })
      .mockResolvedValueOnce({ kind: 'failed', error: 'x' })
      .mockResolvedValueOnce({ kind: 'no_subscription' })
    await expect(task.run()).resolves.toEqual({
      result: { applied: 1, failed: 1, no_subscription: 1 },
    })
    expect(reportBrandCount.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
  })

  it('🔴 logs every count it changes, with org and old → new, and counts them', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportBrandCount
      .mockResolvedValueOnce({ kind: 'applied', activeBrands: 13, previousActiveBrands: 11 })
      .mockResolvedValueOnce({ kind: 'applied', activeBrands: 4, previousActiveBrands: 4 })
      .mockResolvedValueOnce({ kind: 'applied', activeBrands: 2, previousActiveBrands: null })
    await expect(task.run()).resolves.toEqual({ result: { applied: 3, changed: 1 } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toBe('[brand-count-reconcile] org a: billed count 11 → 13')
  })
})
