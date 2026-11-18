import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe("🔴 the limiter's PREMISE, which lives in an absence", () => {
  // SlidingWindowRateLimiter is in-memory and process-local. Its own header
  // says "for the single-VM topology this is fine" — and that is true, but it
  // is true because of something no code states: production runs ONE container.
  //
  // 🔴 THE DANGER IS THE SHAPE OF THE PREMISE. It is not a setting someone
  // turned on; it is the ABSENCE of a `replicas` key. So the day anyone scales
  // the app to two instances, every per-key limit silently becomes 2x — three
  // enforcement sites at once (the CDN route, the account export, and the
  // provisioning path) — and nothing anywhere fails. A guard whose premise can
  // be invalidated by an unrelated change, with no signal, is the failure mode
  // this cell exists to convert into a red build.
  //
  // Measured 2026-10-03: `docker-compose.production.yml` declares the app as
  // `ghcr.io/30blackbirds/grundtone-studio:${IMAGE_TAG}` with no `deploy` block
  // and no `replicas`, so Compose runs exactly one. The outside probe agreed —
  // six /api/healthz calls against prod returned a monotonic uptime (432898 ->
  // 432903 s, matching the 28/9 deploy), which is CONSISTENT with one instance
  // without proving it: two containers started in the same second would look
  // identical from there.
  //
  // 🔴 WHAT THIS CELL CANNOT SEE, so a green is not read as more than it is: the
  // RUNNING count. A `docker compose up --scale app=2`, a second host, or a
  // deploy path that does not use this file would all leave this green. It
  // measures the DECLARATION, which is the only part of the premise that lives
  // in this repository.
  const COMPOSE = join(import.meta.dirname, '..', '..', '..', '..', 'docker-compose.production.yml')

  it('production still declares a single app instance', () => {
    const src = readFileSync(COMPOSE, 'utf8')
    // Positive control: the file we think we are reading is the one that
    // deploys studio. Without this, a moved or renamed file would make the
    // assertion below pass by reading nothing relevant.
    expect(src).toContain('ghcr.io/30blackbirds/grundtone-studio')
    expect(src).not.toMatch(/replicas/)
    // If this turns red: the limiter is now per-instance and the effective
    // limit is N x configured. Back it onto Redis (the class header names the
    // SETNX + sliding-window pattern) before scaling, or accept the multiple
    // and say so.
  })
})
