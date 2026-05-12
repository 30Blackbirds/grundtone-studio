import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TTLCache } from './ttl-cache'

describe('TTLCache', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns undefined for unknown keys', () => {
    const c = new TTLCache<string, number>(10, 1000)
    expect(c.get('missing')).toBeUndefined()
  })

  it('stores and returns within TTL', () => {
    const c = new TTLCache<string, number>(10, 1000)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
  })

  it('expires entries past the TTL', () => {
    const c = new TTLCache<string, number>(10, 1000)
    c.set('a', 1)
    vi.advanceTimersByTime(1500)
    expect(c.get('a')).toBeUndefined()
  })

  it('refreshes LRU order on get (not on set-overwrite)', () => {
    const c = new TTLCache<string, number>(3, 60_000)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    // touch 'a' so it's most-recent; oldest is now 'b'
    c.get('a')
    c.set('d', 4) // evicts 'b'
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBe(1)
    expect(c.get('c')).toBe(3)
    expect(c.get('d')).toBe(4)
  })

  it('evicts the oldest entry when over capacity', () => {
    const c = new TTLCache<string, number>(2, 60_000)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3) // 'a' falls out
    expect(c.get('a')).toBeUndefined()
    expect(c.size).toBe(2)
  })

  it('delete and clear behave as expected', () => {
    const c = new TTLCache<string, number>(10, 60_000)
    c.set('a', 1)
    c.delete('a')
    expect(c.get('a')).toBeUndefined()
    c.set('b', 2)
    c.clear()
    expect(c.size).toBe(0)
  })
})
