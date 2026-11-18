import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyBrandCountChanged, onBrandCountChanged } from './brand-hooks'

const off: Array<() => void> = []
afterEach(() => {
  off.splice(0).forEach((f) => f())
  vi.restoreAllMocks()
})
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('brand-count hook', () => {
  it('does nothing with no listener (self-host)', () => {
    expect(() => notifyBrandCountChanged('org-1')).not.toThrow()
  })

  it('tells every listener the org id', async () => {
    const a = vi.fn()
    const b = vi.fn()
    off.push(onBrandCountChanged(a), onBrandCountChanged(b))
    notifyBrandCountChanged('org-1')
    await flush()
    expect(a).toHaveBeenCalledWith('org-1')
    expect(b).toHaveBeenCalledWith('org-1')
  })

  it('never throws and still tells the others when a listener throws or rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = vi.fn()
    off.push(
      onBrandCountChanged(() => {
        throw new Error('sync boom')
      }),
      onBrandCountChanged(() => Promise.reject(new Error('async boom'))),
      onBrandCountChanged(ok),
    )
    expect(() => notifyBrandCountChanged('org-2')).not.toThrow()
    await flush()
    expect(ok).toHaveBeenCalledWith('org-2')
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('does not wait for a slow listener', () => {
    let finished = false
    off.push(
      onBrandCountChanged(async () => {
        await new Promise((r) => setTimeout(r, 50))
        finished = true
      }),
    )
    notifyBrandCountChanged('org-3')
    expect(finished).toBe(false)
  })

  it('stops telling a listener once it is removed', async () => {
    const a = vi.fn()
    const remove = onBrandCountChanged(a)
    remove()
    notifyBrandCountChanged('org-4')
    await flush()
    expect(a).not.toHaveBeenCalled()
  })
})
