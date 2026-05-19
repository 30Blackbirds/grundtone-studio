import { describe, it, expect } from 'vitest'
import { SlidingWindowRateLimiter } from './rate-limit'

const KEY = 'pk_test_a'

describe('SlidingWindowRateLimiter', () => {
  it('allows requests under the limit', () => {
    const rl = new SlidingWindowRateLimiter(1000)
    expect(rl.check(KEY, 3, 1000).ok).toBe(true)
    expect(rl.check(KEY, 3, 1001).ok).toBe(true)
    expect(rl.check(KEY, 3, 1002).ok).toBe(true)
  })

  it('blocks at the limit', () => {
    const rl = new SlidingWindowRateLimiter(1000)
    for (let i = 0; i < 5; i++) rl.check(KEY, 5, 1000 + i)
    const blocked = rl.check(KEY, 5, 1005)
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('lets requests through again after the window slides', () => {
    const rl = new SlidingWindowRateLimiter(1000)
    // Fill the bucket at t=1000
    for (let i = 0; i < 3; i++) rl.check(KEY, 3, 1000)
    expect(rl.check(KEY, 3, 1500).ok).toBe(false)
    // Window slides past 1000 — now empty
    expect(rl.check(KEY, 3, 2100).ok).toBe(true)
  })

  it('returns the time at which the next slot opens', () => {
    const rl = new SlidingWindowRateLimiter(1000)
    rl.check(KEY, 1, 5000)
    const blocked = rl.check(KEY, 1, 5100)
    expect(blocked.ok).toBe(false)
    expect(blocked.resetAt).toBe(6000) // oldest timestamp (5000) + window
  })

  it('isolates buckets across keys', () => {
    const rl = new SlidingWindowRateLimiter(1000)
    for (let i = 0; i < 3; i++) rl.check('a', 3, 1000)
    expect(rl.check('a', 3, 1000).ok).toBe(false)
    expect(rl.check('b', 3, 1000).ok).toBe(true)
  })

  it('evicts oldest key past maxKeys to bound memory', () => {
    const rl = new SlidingWindowRateLimiter(1000, 2)
    rl.check('a', 10, 1000)
    rl.check('b', 10, 1000)
    rl.check('c', 10, 1000) // 'a' should fall out
    expect(rl.size).toBe(2)
    // 'a' resets — gets full quota again
    for (let i = 0; i < 10; i++) rl.check('a', 10, 1000 + i)
    expect(rl.check('a', 10, 1010).ok).toBe(false)
  })
})
