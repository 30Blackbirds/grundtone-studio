import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}))

const updates: { values: unknown; where: unknown }[] = []
let updateRejects = false

vi.mock('~~/server/db', () => ({
  db: {
    update: () => ({
      set: (values: unknown) => ({
        where: (where: unknown) => {
          updates.push({ values, where })
          return updateRejects
            ? Promise.reject(new Error('connection terminated'))
            : Promise.resolve()
        },
      }),
    }),
  },
}))

vi.mock('~~/server/db/schema', () => ({ apiKey: { keyHash: 'keyHash' } }))

const { recordKeyUse, shouldRecordUse, THROTTLE_MS } = await import('./key-usage')

beforeEach(() => {
  updates.length = 0
  updateRejects = false
})

describe('shouldRecordUse', () => {
  it('records a key this process has not seen', () => {
    expect(shouldRecordUse(undefined, 1_000)).toBe(true)
  })

  it('does not record again inside the window', () => {
    expect(shouldRecordUse(1_000, 1_000 + THROTTLE_MS - 1)).toBe(false)
  })

  it('records again at the window edge, not only past it', () => {
    // The boundary is where an off-by-one hides: `>` instead of `>=` would
    // stretch every window by one tick forever, which no other cell would see.
    expect(shouldRecordUse(1_000, 1_000 + THROTTLE_MS)).toBe(true)
  })
})

describe('recordKeyUse', () => {
  it('writes the timestamp for a key it has not seen', () => {
    recordKeyUse('hash-a', 5_000)
    expect(updates).toHaveLength(1)
    expect((updates[0]!.values as { lastUsedAt: Date }).lastUsedAt).toEqual(new Date(5_000))
  })

  it('🔴 writes once per key per window, however many requests arrive', () => {
    // The whole point of the throttle: this runs on the CDN hot path, where a
    // write per request would put an UPDATE in front of every asset.
    for (let i = 0; i < 500; i++) recordKeyUse('hash-b', 10_000 + i)
    expect(updates).toHaveLength(1)
  })

  it('writes again once the window has passed', () => {
    recordKeyUse('hash-c', 0)
    recordKeyUse('hash-c', THROTTLE_MS)
    expect(updates).toHaveLength(2)
  })

  it('throttles per key, not globally', () => {
    // The discriminating case: a single shared timestamp would silence every
    // other key for an hour after the first one was written, and the column
    // would go back to lying — for a different set of rows.
    recordKeyUse('hash-d', 0)
    recordKeyUse('hash-e', 1)
    expect(updates).toHaveLength(2)
  })

  it('marks the key before awaiting, so concurrent requests write once', () => {
    // Both calls happen before any promise resolves — the same interleaving two
    // in-flight CDN requests produce.
    recordKeyUse('hash-f', 0)
    recordKeyUse('hash-f', 1)
    expect(updates).toHaveLength(1)
  })

  it('🔴 never throws when the database rejects, and never returns a promise', async () => {
    // A usage signal must not turn a working CDN response into a 500. The
    // rejection is provoked, not assumed absent.
    updateRejects = true
    expect(() => recordKeyUse('hash-g', 0)).not.toThrow()
    expect(recordKeyUse('hash-h', 0)).toBeUndefined()
    // Let the rejected promise settle; an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 0))
    expect(updates).toHaveLength(2)
  })

  it('targets the key by its hash, never by plaintext', () => {
    recordKeyUse('hash-i', 0)
    expect(updates[0]!.where).toEqual({ op: 'eq', col: 'keyHash', val: 'hash-i' })
  })
})
