import { describe, it, expect } from 'vitest'
import { tokensSchema, DEFAULT_TOKENS, resolveMode } from './tokens'

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

describe('dark overrides (override model, 2026-07-29)', () => {
  it('accepts a dark layer with partial color overrides', () => {
    const res = tokensSchema.safeParse({
      colors: { primary: '#0059b3', background: '#ffffff' },
      dark: { colors: { background: '#111318', text: '#e8eaef' } },
    })
    expect(res.success).toBe(true)
  })

  it('rejects non-color groups in the dark layer (v1 scope)', () => {
    const res = tokensSchema.safeParse({ dark: { spacing: { md: '1rem' } } })
    expect(res.success).toBe(false)
  })

  it('rejects invalid colors inside the dark layer', () => {
    const res = tokensSchema.safeParse({ dark: { colors: { primary: 'not a color;' } } })
    expect(res.success).toBe(false)
  })

  it('resolveMode(dark) merges dark colors over base and drops the dark key', () => {
    const resolved = resolveMode(
      {
        colors: { primary: '#0059b3', background: '#ffffff' },
        spacing: { md: '1rem' },
        dark: { colors: { background: '#111318' } },
      },
      'dark',
    )
    expect(resolved.colors).toEqual({ primary: '#0059b3', background: '#111318' })
    expect(resolved.spacing).toEqual({ md: '1rem' })
    expect('dark' in resolved).toBe(false)
  })

  it('resolveMode(light) and empty dark layers return the base unchanged', () => {
    const base = { colors: { primary: '#0059b3' } }
    expect(
      resolveMode({ ...base, dark: { colors: { primary: '#3b82f6' } } }, 'light').colors,
    ).toEqual({ primary: '#0059b3' })
    expect(resolveMode({ ...base, dark: {} }, 'dark').colors).toEqual({ primary: '#0059b3' })
  })
})
