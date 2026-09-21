import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { checkContract } from '../scripts/sdk-contract-guard.mjs'

// KH-991. The guard's rules, driven with fixtures rather than a real git
// history. Every "rejects" cell has a positive control in the same describe —
// a guard that rejects everything would pass the rejection cells alone.

const sri = (b: Buffer) => `sha384-${createHash('sha384').update(b).digest('base64')}\n`

/** A complete, self-consistent version: both bundles, both maps, both SRIs. */
function version(v: string, seed: string): Map<string, Buffer> {
  const js = Buffer.from(`/* umd ${seed} */`)
  const mjs = Buffer.from(`/* esm ${seed} */`)
  return new Map([
    [`v${v}.js`, js],
    [`v${v}.mjs`, mjs],
    [`v${v}.js.map`, Buffer.from('{}')],
    [`v${v}.mjs.map`, Buffer.from('{}')],
    [`v${v}.js.sri`, Buffer.from(sri(js))],
    [`v${v}.mjs.sri`, Buffer.from(sri(mjs))],
  ])
}
const merge = (...maps: Map<string, Buffer>[]) => new Map(maps.flatMap((m) => [...m]))

describe('checkContract — the accept set', () => {
  it('passes a complete, unchanged set (positive control for every cell below)', () => {
    const v100 = version('1.0.0', 'a')
    expect(checkContract({ current: v100, base: v100, contractVersion: '1.0.0' })).toEqual([])
  })

  it('allows ADDING a new version — the only legal change', () => {
    const v100 = version('1.0.0', 'a')
    const current = merge(v100, version('1.0.1', 'b'))
    expect(checkContract({ current, base: v100, contractVersion: '1.0.1' })).toEqual([])
  })
})

describe('checkContract — immutability against the base branch', () => {
  it('rejects ONE changed byte in a published file', () => {
    const base = version('1.0.0', 'a')
    const current = new Map(base)
    current.set('v1.0.0.js.map', Buffer.from('{ }')) // one byte different, SRI untouched
    const errors = checkContract({ current, base, contractVersion: '1.0.0' })
    expect(errors).toEqual([expect.stringContaining('v1.0.0.js.map CHANGED')])
  })

  it('rejects a DELETED published version', () => {
    const v100 = version('1.0.0', 'a')
    const base = merge(v100, version('1.0.1', 'b'))
    const errors = checkContract({ current: version('1.0.1', 'b'), base, contractVersion: '1.0.1' })
    expect(errors.filter((e) => e.includes('DELETED'))).toHaveLength(6)
  })

  it('rejects rewriting a published bundle even when its SRI is rewritten to match', () => {
    // The dangerous edit: someone "fixes" a failing boot-smoke by regenerating
    // both the bundle and its SRI. Self-consistent — and a broken pin for every
    // customer. Only the base comparison can see it.
    const base = version('1.0.0', 'a')
    const current = version('1.0.0', 'REWRITTEN')
    const errors = checkContract({ current, base, contractVersion: '1.0.0' })
    expect(errors.some((e) => e.includes('v1.0.0.js CHANGED'))).toBe(true)
    expect(errors.some((e) => e.includes('v1.0.0.js.sri CHANGED'))).toBe(true)
  })
})

describe('checkContract — self-consistency', () => {
  it('rejects a bundle that does not hash to its committed SRI', () => {
    const current = version('1.0.1', 'b')
    current.set('v1.0.1.js', Buffer.from('/* tampered */'))
    const errors = checkContract({ current, base: new Map(), contractVersion: '1.0.1' })
    expect(errors).toEqual([expect.stringContaining('v1.0.1.js hashes to')])
  })

  it('rejects an incomplete version', () => {
    const current = version('1.0.1', 'b')
    current.delete('v1.0.1.mjs.map')
    const errors = checkContract({ current, base: new Map(), contractVersion: '1.0.1' })
    expect(errors).toEqual([expect.stringContaining('v1.0.1.mjs.map is missing')])
  })

  it('rejects a current contract version with no committed files', () => {
    const errors = checkContract({
      current: version('1.0.0', 'a'),
      base: new Map(),
      contractVersion: '1.0.1',
    })
    expect(errors).toEqual([
      expect.stringContaining('SDK_CONTRACT_VERSION 1.0.1 has no committed files'),
    ])
  })

  it('rejects a stray file that is not a versioned contract file', () => {
    const current = merge(version('1.0.0', 'a'), new Map([['notes.txt', Buffer.from('x')]]))
    const errors = checkContract({ current, base: new Map(), contractVersion: '1.0.0' })
    expect(errors).toEqual([expect.stringContaining('unexpected file in sdk-contract/: notes.txt')])
  })
})
