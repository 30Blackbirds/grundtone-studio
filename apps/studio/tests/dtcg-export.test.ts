import { describe, expect, it } from 'vitest'
import { exportTokens, type StudioTokens } from '@grundtone-studio/dtcg'
import { validateResolverFile, validateTokensFile } from '@grundtone-studio/dtcg/testing'

// Imported from the app, not copied: the fixtures below use the real slot
// list, curated fonts, defaults and schema.
import {
  COLOR_SLOTS,
  CURATED_FONTS,
  DEFAULT_TOKENS,
  tokensSchema,
  type Tokens,
} from '~~/server/lib/tokens'

// Type-level guards (checked by `pnpm typecheck`, not at runtime).
// 1. Studio's token shape must stay assignable to the export package's type.
const _assignable: StudioTokens = {} as Tokens
// 2. Assignability alone allows EXTRA properties, so a field added to
//    tokensSchema would slip through (1) and silently never be exported. Every
//    key Studio stores must be a key the export knows.
type Unmapped<A, B> = Exclude<keyof NonNullable<A>, keyof NonNullable<B>>
type NoUnmapped =
  | Unmapped<Tokens, StudioTokens>
  | Unmapped<Tokens['typography'], StudioTokens['typography']>
  | Unmapped<Tokens['assets'], StudioTokens['assets']>
  | Unmapped<Tokens['dark'], StudioTokens['dark']>
const _allMapped: [NoUnmapped] extends [never] ? true : NoUnmapped = true
void _assignable
void _allMapped

function expectValid(result: { valid: boolean; errors: string[] }) {
  expect(result.valid, result.errors.join('\n')).toBe(true)
}

describe('DTCG export of real Studio token sets (T1, export half)', () => {
  it('DEFAULT_TOKENS exports every token and validates against the official schema', () => {
    const out = exportTokens(DEFAULT_TOKENS, { name: 'main' })
    expectValid(validateTokensFile(out.files.base.document))
    expect(out.report.omitted).toEqual([])
    expect(out.report.exported).toBe(out.report.total)
    expect(out.files.dark).toBeNull()
  })

  it('all 39 color slots + dark + both font slots + logo validate (base, dark, resolver)', () => {
    const full: Tokens = {
      colors: Object.fromEntries(
        COLOR_SLOTS.map((slot, i) => [slot, `#${(i * 6).toString(16).padStart(2, '0')}3355`]),
      ),
      dark: {
        colors: Object.fromEntries(COLOR_SLOTS.map((slot) => [slot, 'rgb(10 20 30 / 80%)'])),
      },
      assets: { logo: { file: 'logo.svg', type: 'svg' } },
      typography: {
        fontFamily: { base: "'Source Sans 3', sans-serif", heading: 'Inter', mono: 'monospace' },
        slots: {
          heading: {
            source: 'curated',
            family: CURATED_FONTS[1],
            weights: [400, 800],
            fallbacks: ['system-grotesk', 'humanist'],
          },
          body: {
            source: 'custom',
            family: 'Brand Text',
            weights: [400],
            files: { '400': 'fonts/brand-text-400.woff2' },
            fallbacks: ['serif-classic'],
          },
        },
      },
      radius: { sm: '2px', md: '0.5rem', lg: '12pt', xl: '0' },
      spacing: { sm: '4px', md: '1rem', lg: '1.5rem' },
    }
    // The fixture must be a set Studio would actually save.
    expect(tokensSchema.safeParse(full).success).toBe(true)
    expect(COLOR_SLOTS).toHaveLength(39)

    const out = exportTokens(full, { name: 'full' })
    expectValid(validateTokensFile(out.files.base.document))
    expectValid(validateTokensFile(out.files.dark!.document))
    expectValid(validateResolverFile(out.files.resolver!.document))
    // 39 + 39 colors, 3 families, 2 slot families + 3 weights, 4 radius, 3 spacing.
    expect(out.report).toMatchObject({ total: 93, exported: 93, omitted: [] })
    expect(out.report.converted.map((e) => e.code).sort()).toEqual([
      'unit_converted',
      'unitless_zero',
    ])
  })
})
