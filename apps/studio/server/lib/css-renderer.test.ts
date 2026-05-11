import { describe, it, expect } from 'vitest'
import { renderTokensCss } from './css-renderer'

describe('renderTokensCss', () => {
  it('wraps output in :root { ... }', () => {
    const css = renderTokensCss({})
    expect(css).toMatch(/^:root \{/)
    expect(css.trim()).toMatch(/\}$/)
  })

  it('emits color custom properties with kebab-case names', () => {
    const css = renderTokensCss({
      colors: { primary: '#4F46E5', primaryLight: '#818CF8', onPrimary: '#FFFFFF' },
    })
    expect(css).toContain('--color-primary: #4F46E5;')
    expect(css).toContain('--color-primary-light: #818CF8;')
    expect(css).toContain('--color-on-primary: #FFFFFF;')
  })

  it('emits radius / spacing / font-family with stable prefixes', () => {
    const css = renderTokensCss({
      radius: { md: '0.5rem' },
      spacing: { md: '1rem' },
      typography: { fontFamily: { base: 'Inter, sans-serif' } },
    })
    expect(css).toContain('--radius-md: 0.5rem;')
    expect(css).toContain('--space-md: 1rem;')
    expect(css).toContain('--font-family-base: Inter, sans-serif;')
  })

  it('skips undefined values', () => {
    const css = renderTokensCss({
      colors: { primary: '#000', secondary: undefined as unknown as string },
    })
    expect(css).toContain('--color-primary: #000;')
    expect(css).not.toContain('--color-secondary')
  })

  it('outputs deterministic CSS for the same input', () => {
    const tokens = { colors: { primary: '#000', secondary: '#fff' } }
    expect(renderTokensCss(tokens)).toBe(renderTokensCss(tokens))
  })
})
