import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withRetry } from './retry'

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('returns immediately when the call succeeds on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const promise = withRetry(fn, { attempts: 3, initialDelayMs: 100, factor: 2 })
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries until success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip 1'))
      .mockRejectedValueOnce(new Error('blip 2'))
      .mockResolvedValue('ok')
    const promise = withRetry(fn, { attempts: 3, initialDelayMs: 100, factor: 2 })
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(200)
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last error after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'))
    // Attach a noop catch eagerly so the rejection that fires during
    // advanceTimersByTimeAsync isn't observed as "unhandled" by the runner.
    // The real assertion comes via expect().rejects after the timeline
    // finishes.
    const promise = withRetry(fn, { attempts: 3, initialDelayMs: 50, factor: 2 })
    const observed = promise.catch((err: unknown) => err as Error)
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(100)
    const err = (await observed) as Error
    expect(err.message).toBe('persistent')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('honours the exponential backoff factor', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('ok')

    const promise = withRetry(fn, { attempts: 3, initialDelayMs: 100, factor: 3 })

    // First retry waits 100ms.
    await vi.advanceTimersByTimeAsync(99)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)

    // Second retry waits 100 * 3 = 300ms (the factor applied after the
    // first retry).
    await vi.advanceTimersByTimeAsync(299)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(3)

    await expect(promise).resolves.toBe('ok')
  })

  it('attempts=1 means no retry — error propagates immediately', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('once'))
    await expect(withRetry(fn, { attempts: 1, initialDelayMs: 100, factor: 2 })).rejects.toThrow(
      'once',
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
