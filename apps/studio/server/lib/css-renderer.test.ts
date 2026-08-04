import { describe, it, expect } from 'vitest'
import { renderTokensCss } from './css-renderer'
import { DEFAULT_TOKENS, tokensSchema, type Tokens } from './tokens'

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

describe('publish round-trip safety', () => {
  // Locks in the JSON → JSON pipeline through the actual storage shape.
  // Publish does:
  //    1. tokens object → JSON.stringify (with 2-space indent)
  //    2. blob upload + DB row keeping the original tokensJson
  //    3. activate / rollback later reads tokensJson back from the DB,
  //       JSON.stringifies again, writes to current.json
  // The roundtrip needs to be lossless and idempotent across all token
  // fields the schema knows about — that's the contract a customer's CDN
  // depends on.

  it('JSON.stringify(tokens) parses back to the exact same shape', () => {
    const reparsed = JSON.parse(JSON.stringify(DEFAULT_TOKENS))
    expect(reparsed).toEqual(DEFAULT_TOKENS)
  })

  it('tokensSchema.parse re-validates a stringified-then-parsed default', () => {
    // Catches the case where the schema would reject its own default —
    // would happen if a regex tightened without updating DEFAULT_TOKENS.
    const roundtrip = JSON.parse(JSON.stringify(DEFAULT_TOKENS))
    expect(() => tokensSchema.parse(roundtrip)).not.toThrow()
  })

  it('renderTokensCss is idempotent across two parse-stringify cycles', () => {
    // Same tokens object should emit the same CSS even after the tokens
    // have been round-tripped through JSON — neutralises key-ordering
    // and subtle JS object-identity assumptions.
    const once = JSON.parse(JSON.stringify(DEFAULT_TOKENS)) as Tokens
    const twice = JSON.parse(JSON.stringify(once)) as Tokens
    const a = renderTokensCss(DEFAULT_TOKENS)
    const b = renderTokensCss(once)
    const c = renderTokensCss(twice)
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('emits all 15 default color custom properties', () => {
    const css = renderTokensCss(DEFAULT_TOKENS)
    // Each color in DEFAULT_TOKENS must surface as a CSS variable line.
    // Catches a missed-field bug if a future schema addition forgets to
    // wire the renderer.
    const colorKeys = Object.keys(DEFAULT_TOKENS.colors ?? {})
    for (const key of colorKeys) {
      const kebab = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      expect(css).toContain(`--color-${kebab}:`)
    }
    expect(colorKeys.length).toBeGreaterThanOrEqual(15)
  })

  it('emits the canonical fixture for DEFAULT_TOKENS', () => {
    // Golden-file snapshot for the studio's bundled default theme. A
    // change here means *every freshly created project* paints differently
    // on the customer's CDN. If the diff is intentional, update the
    // fixture in the same PR and explain why in the body.
    expect(renderTokensCss(DEFAULT_TOKENS)).toMatchInlineSnapshot(`
      ":root {
        --color-primary: #4F46E5;
        --color-primary-light: #818CF8;
        --color-primary-dark: #3730A3;
        --color-on-primary: #FFFFFF;
        --color-secondary: #0EA5E9;
        --color-success: #10B981;
        --color-warning: #F59E0B;
        --color-error: #EF4444;
        --color-info: #3B82F6;
        --color-background: #FFFFFF;
        --color-surface: #F9FAFB;
        --color-surface-raised: #FFFFFF;
        --color-text: #111827;
        --color-text-secondary: #4B5563;
        --color-text-tertiary: #9CA3AF;
        --space-sm: 0.5rem;
        --space-md: 1rem;
        --space-lg: 1.5rem;
        --font-family-base: Inter, system-ui, sans-serif;
        --font-family-heading: Inter, system-ui, sans-serif;
        --font-family-mono: JetBrains Mono, monospace;
        --radius-sm: 0.25rem;
        --radius-md: 0.5rem;
        --radius-lg: 0.75rem;
        --radius-xl: 1rem;
      }
      "
    `)
  })
})

describe('dark-override block', () => {
  it('emits media-query + data-attribute selectors for dark color overrides', () => {
    const css = renderTokensCss({
      colors: { primary: '#0059b3', background: '#ffffff' },
      dark: { colors: { background: '#111318' } },
    })
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain(":root:not([data-gt-mode='light'])")
    expect(css).toContain(":root[data-gt-mode='dark']")
    // Only the overridden token appears in the dark blocks.
    const darkPart = css.slice(css.indexOf('@media'))
    expect(darkPart).toContain('--color-background: #111318;')
    expect(darkPart).not.toContain('--color-primary')
  })

  it('emits no dark block when the dark layer is absent or empty', () => {
    expect(renderTokensCss({ colors: { primary: '#0059b3' } })).not.toContain('@media')
    expect(renderTokensCss({ colors: { primary: '#0059b3' }, dark: { colors: {} } })).not.toContain(
      '@media',
    )
  })
})

describe('@font-face generation (brand-assets webFont)', () => {
  it('renders one block per weight with relative urls (curated)', () => {
    const css = renderTokensCss({
      typography: { webFont: { source: 'curated', family: 'Manrope', weights: [700, 400] } },
    })
    expect(css).toContain("font-family: 'Manrope';")
    expect(css).toContain("src: url('fonts/manrope-400.woff2') format('woff2');")
    expect(css).toContain("src: url('fonts/manrope-700.woff2') format('woff2');")
    expect(css.indexOf('font-weight: 400')).toBeLessThan(css.indexOf('font-weight: 700'))
    expect(css).toContain('font-display: swap;')
  })

  it('uses the uploaded file map for custom fonts', () => {
    const css = renderTokensCss({
      typography: {
        webFont: {
          source: 'custom',
          family: 'Asp Grotesk',
          weights: [400],
          files: { '400': 'fonts/asp-grotesk-400.woff2' },
        },
      },
    })
    expect(css).toContain("font-family: 'Asp Grotesk';")
    expect(css).toContain("src: url('fonts/asp-grotesk-400.woff2') format('woff2');")
  })

  it('emits no @font-face without a webFont', () => {
    expect(renderTokensCss({ colors: { primary: '#000' } })).not.toContain('@font-face')
  })
})
