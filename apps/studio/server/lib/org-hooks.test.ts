import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyOrgServed, onOrgServed } from './org-hooks'

// The listener mechanics (no wait, never throws, removal) are covered once in
// brand-hooks.test.ts; both hooks are built by hook.ts. This file checks what
// is specific to the org-served hook: the org it passes on and the log line.

const off: Array<() => void> = []
afterEach(() => {
  off.splice(0).forEach((f) => f())
  vi.restoreAllMocks()
})
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('org-served hook', () => {
  it('does nothing with no listener (self-host)', () => {
    expect(() => notifyOrgServed({ id: 'o1', slug: 'a' })).not.toThrow()
  })

  it('passes the served org to every listener', async () => {
    const a = vi.fn()
    off.push(onOrgServed(a))
    const org = { id: 'o2', slug: 'acme', createdAt: '2026-11-01T00:00:00.000Z' }
    notifyOrgServed(org)
    await flush()
    expect(a).toHaveBeenCalledWith(org)
  })

  it('logs a failing listener under its own tag with the org id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    off.push(onOrgServed(() => Promise.reject(new Error('boom'))))
    notifyOrgServed({ id: 'o3', slug: 'b' })
    await flush()
    expect(console.error).toHaveBeenCalledWith(
      '[org-hooks] listener failed for org o3:',
      expect.any(Error),
    )
  })
})
