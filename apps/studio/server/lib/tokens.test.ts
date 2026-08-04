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

describe('brand-assets (locked schema 2026-08-03)', () => {
  it('accepts a logo reference with matching type', () => {
    expect(
      tokensSchema.safeParse({ assets: { logo: { file: 'logo.svg', type: 'svg' } } }).success,
    ).toBe(true)
    expect(
      tokensSchema.safeParse({ assets: { logo: { file: 'logo.png', type: 'png' } } }).success,
    ).toBe(true)
  })

  it('rejects traversal/absolute logo references', () => {
    for (const file of ['../secret.svg', '/etc/passwd', 'https://evil.example/logo.svg', 'x.svg']) {
      expect(tokensSchema.safeParse({ assets: { logo: { file, type: 'svg' } } }).success).toBe(
        false,
      )
    }
  })

  it('accepts a curated webFont from the v1 list with weights', () => {
    const res = tokensSchema.safeParse({
      typography: { webFont: { source: 'curated', family: 'Manrope', weights: [400, 600, 700] } },
    })
    expect(res.success).toBe(true)
  })

  it('rejects curated families outside the v1 list and invalid weights', () => {
    expect(
      tokensSchema.safeParse({
        typography: { webFont: { source: 'curated', family: 'Comic Sans MS', weights: [400] } },
      }).success,
    ).toBe(false)
    expect(
      tokensSchema.safeParse({
        typography: { webFont: { source: 'curated', family: 'Inter', weights: [350] } },
      }).success,
    ).toBe(false)
    expect(
      tokensSchema.safeParse({
        typography: { webFont: { source: 'curated', family: 'Inter', weights: [400, 400] } },
      }).success,
    ).toBe(false)
  })

  it('accepts a custom webFont with one file per weight', () => {
    const res = tokensSchema.safeParse({
      typography: {
        webFont: {
          source: 'custom',
          family: 'Asp Grotesk',
          weights: [400, 700],
          files: { '400': 'fonts/asp-grotesk-400.woff2', '700': 'fonts/asp-grotesk-700.woff2' },
        },
      },
    })
    expect(res.success).toBe(true)
  })

  it('rejects custom webFont when files and weights diverge', () => {
    const base = { source: 'custom', family: 'Asp Grotesk', weights: [400, 700] }
    expect(
      tokensSchema.safeParse({
        typography: { webFont: { ...base, files: { '400': 'fonts/a-400.woff2' } } },
      }).success,
    ).toBe(false)
    expect(
      tokensSchema.safeParse({
        typography: {
          webFont: {
            ...base,
            files: { '400': 'fonts/a-400.woff2', '500': 'fonts/a-500.woff2' },
          },
        },
      }).success,
    ).toBe(false)
  })

  it('rejects custom font files with traversal or wrong format', () => {
    for (const file of ['../x.woff2', 'fonts/../x.woff2', 'fonts/x.ttf', 'https://e.x/f.woff2']) {
      expect(
        tokensSchema.safeParse({
          typography: {
            webFont: { source: 'custom', family: 'X', weights: [400], files: { '400': file } },
          },
        }).success,
      ).toBe(false)
    }
  })
})
