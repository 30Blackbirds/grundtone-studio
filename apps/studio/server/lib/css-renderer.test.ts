import { describe, it, expect } from 'vitest'
import { fontFamilyChain, renderTokensCss } from './css-renderer'
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

describe('@font-face + font-family chains (two-slot revision)', () => {
  it('renders blocks per weight with slot-prefixed relative urls (curated)', () => {
    const css = renderTokensCss({
      typography: {
        slots: {
          heading: {
            source: 'curated',
            family: 'Manrope',
            weights: [700, 400],
            fallbacks: ['neutral-grotesk', 'system-grotesk'],
          },
        },
      },
    })
    expect(css).toContain("font-family: 'Manrope';")
    expect(css).toContain("src: url('fonts/heading-manrope-400.woff2') format('woff2');")
    expect(css).toContain("src: url('fonts/heading-manrope-700.woff2') format('woff2');")
    expect(css.indexOf('font-weight: 400')).toBeLessThan(css.indexOf('font-weight: 700'))
    expect(css).toContain('font-display: swap;')
  })

  it('emits the forlæg chain: primary, fallback stacks in order, generic from LAST fallback', () => {
    const css = renderTokensCss({
      typography: {
        slots: {
          heading: {
            source: 'curated',
            family: 'Manrope',
            weights: [700],
            fallbacks: ['neutral-grotesk', 'system-grotesk'],
          },
          body: {
            source: 'custom',
            family: 'IBM Plex Sans',
            weights: [400],
            files: { '400': 'fonts/body-ibm-plex-sans-400.woff2' },
            fallbacks: ['system-grotesk', 'serif-classic'],
          },
        },
      },
    })
    expect(css).toContain(
      "--font-family-heading: 'Manrope', 'Helvetica Neue', Arial, 'Segoe UI', Roboto, sans-serif;",
    )
    expect(css).toContain(
      "--font-family-base: 'IBM Plex Sans', 'Segoe UI', Roboto, Georgia, Cambria, serif;",
    )
  })

  it('slot chains WIN over manual fontFamily strings for their vars', () => {
    const css = renderTokensCss({
      typography: {
        fontFamily: { heading: 'Comic Sans MS' },
        slots: {
          heading: { source: 'curated', family: 'Inter', weights: [700], fallbacks: ['humanist'] },
        },
      },
    })
    const lastHeading = css.lastIndexOf('--font-family-heading:')
    expect(css.slice(lastHeading)).toContain("'Inter'")
  })

  it('uses the uploaded file map for custom fonts', () => {
    const css = renderTokensCss({
      typography: {
        slots: {
          body: {
            source: 'custom',
            family: 'Asp Grotesk',
            weights: [400],
            files: { '400': 'fonts/body-asp-grotesk-400.woff2' },
            fallbacks: ['humanist'],
          },
        },
      },
    })
    expect(css).toContain("font-family: 'Asp Grotesk';")
    expect(css).toContain("src: url('fonts/body-asp-grotesk-400.woff2') format('woff2');")
  })

  it('emits no @font-face without slots', () => {
    expect(renderTokensCss({ colors: { primary: '#000' } })).not.toContain('@font-face')
  })
})

// 🔴 CSS-injektion via font-familienavn ([sikkerhed], Opengrep-runden
// 2026-08-11). Den gamle form var `slot.family.replace(/'/g, '')` — den
// fjernede KUN apostroffer.
//
// To veje udenom, begge målt før fixet:
//   · et navn der ENDER på `\` escaper den afsluttende apostrof
//   · et linjeskift indsætter egne CSS-linjer i @font-face-blokken
//
// Og den kontrol ingen havde kørt: afviser tokens-skemaet dem? NEJ.
// `z.string().min(1).max(100)` slap `a\`, `a\nb`, CRLF og `a;}body{…`
// igennem uden indsigelse. Kuraterede fonte går gennem `z.enum` og var
// aldrig i fare — kun `source: 'custom'`.
//
// Alvorlighed er LAV, fordi CSS'en serveres pr. projekt ind på kundens EGET
// site: en injektion rammer kunden selv, ikke andre tenants. Det ændrer
// ikke, at rendereren skal være korrekt af sig selv.
describe('font-familienavn kan ikke bryde ud af CSS-strengen', () => {
  const slot = (family: string) => ({
    source: 'custom' as const,
    family,
    weights: [400 as const],
    files: {},
    fallbacks: ['humanist' as const],
  })

  it('fjerner backslash, saa navnet ikke kan escape sin egen apostrof', () => {
    const css = fontFamilyChain(slot('a\\'))
    expect(css).not.toContain('\\')
    expect(css.startsWith("'a'")).toBe(true)
  })

  // 🔴 HVILKEN AF DISSE BAERER: **`\n` og `\r\n`**. [sikkerhed] maalte mod en
  // rigtig CSSOM (Blink), med godartet kontrol-input som instrument-bevis:
  //   `a<LF>}body{display:none`  ->  CSSStyleRule[body] i stylesheetet, og
  //                                  den efterfoelgende regel destrueret
  // Det er ikke en parse-fejl — det er en INDSAT regel.
  //
  // U+2028/U+2029 parser derimod IDENTISK med et godartet navn: de er ikke
  // CSS-linjeskift. De staar her som billig ekstra daekning, ikke som
  // vektoren. **Vil nogen forenkle: det er LF/CR-casene der maa blive.**
  //
  // De to skrives som escapes med VILJE — de raa tegn i kildefilen braekker
  // esbuilds parser (maalt).
  it('fjerner linjeskift, saa der ikke kan indsaettes CSS-linjer', () => {
    for (const nl of ['\n', '\r\n', '\u2028', '\u2029']) {
      const css = fontFamilyChain(slot(`a${nl}b`))
      expect(css, `linjeskift ${JSON.stringify(nl)} slap igennem`).toBe(
        "'ab', Verdana, Geneva, sans-serif",
      )
    }
  })

  it('fjerner begge citationstegn', () => {
    expect(fontFamilyChain(slot('a"b'))).not.toContain('"')
    expect(fontFamilyChain(slot("a'b"))).toBe("'ab', Verdana, Geneva, sans-serif")
  })

  it('lader almindelige familienavne vaere i fred', () => {
    expect(fontFamilyChain(slot('Helvetica Neue'))).toContain("'Helvetica Neue'")
  })
})

// 🔴 SKEMA-LAGET, ikke kun rendereren ([copilot]-fund). PR'en aendrer BEGGE
// lag, men testene ovenfor maalte kun det ene. Loesnes `family`-regexen i
// tokens.ts ved en oprydning, ville rendereren blive ved at vaere sikker —
// og INTET ville fange, at den foerste spaerre var forsvundet.
//
// Samme fejlform som flaade-checklistens §2.7: en gate maaler at de tests der
// FINDES bestaar, ikke at de der SKAL findes er der.
//
// Kontroltegnene skrives som escapes — raa tegn i kildefilen braekker
// esbuilds parser (maalt).
describe('tokensSchema afviser de samme usikre familienavne', () => {
  // 🔴 Stien er `typography.slots.heading` — IKKE `fonts`. Foerste udgave af
  // denne fixture brugte `fonts`, og skemaet er `.strict()`: de otte
  // afvisnings-cases bestod dermed paa `Unrecognized key: "fonts"` og ikke paa
  // family-regexen. **Otte groenne tests der maalte den forkerte ting.**
  // Fanget kun fordi ACCEPT-casene ogsaa fejlede — en test der forventer
  // `false` kan ikke selv opdage, at den faar `false` af en anden grund.
  const withFamily = (family: string) => ({
    ...DEFAULT_TOKENS,
    // `typography` er `.partial()`, saa vi behoever ikke baere resten med —
    // og en spread af DEFAULT_TOKENS.typography typer ikke (TS2698).
    typography: {
      slots: {
        heading: {
          source: 'custom' as const,
          family,
          weights: [400],
          files: { 400: 'fonts/probe-regular.woff2' },
          fallbacks: ['humanist'],
        },
      },
    },
  })

  it.each([
    ['backslash til sidst', 'a\\'],
    ['linjeskift', 'a\nb'],
    ['CRLF', 'a\r\nb'],
    ['U+2028', 'a\u2028b'],
    ['U+2029', 'a\u2029b'],
    ['apostrof', "a'b"],
    ['citationstegn', 'a"b'],
    ['NUL', 'a\u0000b'],
  ])('afviser %s', (_navn, family) => {
    expect(tokensSchema.safeParse(withFamily(family)).success).toBe(false)
  })

  it('accepterer et almindeligt navn — spaerren maa ikke koebes for bredt', () => {
    expect(tokensSchema.safeParse(withFamily('Helvetica Neue')).success).toBe(true)
  })

  // Ikke-ASCII skal IGENNEM: en blokliste der ved et uheld blev til en
  // ASCII-allowliste ville afvise legitime kunde-fonte.
  it('accepterer ikke-ASCII navne (CJK, kyrillisk, accenttegn)', () => {
    for (const f of ['ヒラギノ角ゴ', 'Гарамонд', 'Ærø Sans']) {
      expect(tokensSchema.safeParse(withFamily(f)).success, f).toBe(true)
    }
  })
})
