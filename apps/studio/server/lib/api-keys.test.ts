import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey } from './api-keys'

describe('generateApiKey', () => {
  it('produces a pk_live_ key with a 32-hex random suffix', () => {
    const k = generateApiKey('live')
    expect(k.plaintext).toMatch(/^pk_live_[0-9a-f]{64}$/)
  })

  it('produces a pk_test_ key when environment is test', () => {
    const k = generateApiKey('test')
    expect(k.plaintext).toMatch(/^pk_test_/)
  })

  it('stores the first 12 chars as prefix', () => {
    const k = generateApiKey('live')
    expect(k.prefix).toBe(k.plaintext.slice(0, 12))
    expect(k.prefix).toMatch(/^pk_live_[0-9a-f]{4}$/)
  })

  it('returns SHA-256 hash that matches hashApiKey of plaintext', () => {
    const k = generateApiKey('live')
    expect(k.hash).toBe(hashApiKey(k.plaintext))
    expect(k.hash).toHaveLength(64)
  })

  it('does not collide across many generations', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(generateApiKey('live').plaintext)
    expect(seen.size).toBe(1000)
  })

  it('produces an sk_ prefixed key for the secret key type', () => {
    const k = generateApiKey('live', 'secret')
    expect(k.plaintext).toMatch(/^sk_live_[0-9a-f]{64}$/)
    expect(k.prefix).toMatch(/^sk_live_[0-9a-f]{4}$/)
    expect(k.hash).toBe(hashApiKey(k.plaintext))
  })

  it('defaults to publishable (pk_) when no key type is given', () => {
    expect(generateApiKey('live').plaintext).toMatch(/^pk_/)
  })
})

describe('hashApiKey', () => {
  it('is deterministic', () => {
    const a = hashApiKey('pk_live_known')
    const b = hashApiKey('pk_live_known')
    expect(a).toBe(b)
  })

  it('produces different hashes for different inputs', () => {
    expect(hashApiKey('pk_live_a')).not.toBe(hashApiKey('pk_live_b'))
  })
})
