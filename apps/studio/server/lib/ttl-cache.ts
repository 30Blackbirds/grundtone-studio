/**
 * Tiny in-memory TTL + LRU cache. One-process scope — sufficient for the
 * single-VM topology in Phase 5/6. When we go multi-instance, swap for
 * Redis behind the same interface.
 *
 * Map-based: insertion order doubles as LRU order. On get, we re-insert
 * the entry to mark it most-recent. On set, we evict the front of the
 * Map until we're under max size. Expired entries are dropped on access
 * (lazy) — no background timer needed.
 */
export class TTLCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>()

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    this.store.delete(key)
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value as K | undefined
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  delete(key: K): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}
