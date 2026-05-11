import { describe, it, expect } from 'vitest'
import { tokensSchema, DEFAULT_TOKENS } from './tokens'

describe('tokensSchema', () => {
  it('accepts DEFAULT_TOKENS', () => {
    expect(tokensSchema.safeParse(DEFAULT_TOKENS).success).toBe(true)
  })

  it('accepts a partial colors object', () => {
    const res = tokensSchema.safeParse({ colors: { primary: '#000' } })
    expect(res.success).toBe(true)
  })

  it('rejects an invalid color', () => {
    const res = tokensSchema.safeParse({ colors: { primary: 'not a color!' } })
    expect(res.success).toBe(false)
  })

  it('accepts valid CSS length units in radius', () => {
    for (const v of ['0.5rem', '8px', '50%', '0']) {
      const res = tokensSchema.safeParse({ radius: { md: v } })
      expect(res.success).toBe(true)
    }
  })

  it('rejects unknown top-level keys (strict mode)', () => {
    const res = tokensSchema.safeParse({ shadows: { md: '0 2px 4px #000' } })
    expect(res.success).toBe(false)
  })

  it('accepts CSS variables in color values', () => {
    const res = tokensSchema.safeParse({ colors: { primary: 'var(--color-brand)' } })
    expect(res.success).toBe(true)
  })
})
