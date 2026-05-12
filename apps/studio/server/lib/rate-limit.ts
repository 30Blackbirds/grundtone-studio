/**
 * Sliding-window rate limiter, in-memory and process-local. For the
 * single-VM topology this is fine. When we go multi-instance the same
 * interface backs onto Redis via SETNX + sliding-window key pattern.
 *
 * Each key gets a list of recent timestamps. `check` drops timestamps
 * outside the window, then accepts or rejects based on the remaining
 * count. Memory is bounded by maxKeys — when full, the oldest key is
 * evicted (its requests reset, which is acceptable for an MVP).
 */
export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number
}

export class SlidingWindowRateLimiter {
  private buckets = new Map<string, number[]>()

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number = 10_000,
  ) {}

  check(key: string, limit: number, now: number = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs
    const existing = this.buckets.get(key) ?? []
    const fresh = existing.filter((t) => t > cutoff)

    if (fresh.length >= limit) {
      this.buckets.set(key, fresh)
      const oldest = fresh[0] ?? now
      return { ok: false, remaining: 0, resetAt: oldest + this.windowMs }
    }

    fresh.push(now)
    this.buckets.delete(key) // re-insert to refresh LRU order
    this.buckets.set(key, fresh)

    while (this.buckets.size > this.maxKeys) {
      const oldestKey = this.buckets.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      this.buckets.delete(oldestKey)
    }

    return {
      ok: true,
      remaining: limit - fresh.length,
      resetAt: now + this.windowMs,
    }
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  clear(): void {
    this.buckets.clear()
  }

  get size(): number {
    return this.buckets.size
  }
}
