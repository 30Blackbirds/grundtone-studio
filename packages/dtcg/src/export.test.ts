import { describe, expect, it } from 'vitest'
import { EXTENSION_KEY, exportTokens, type StudioTokens } from './export'
import { validateResolverFile, validateTokensFile } from './testing/validate'

const minimal: StudioTokens = { colors: { primary: '#4F46E5' }, radius: { md: '0.5rem' } }

describe('exportTokens', () => {
  it('without a dark layer delivers only the base file (E3)', () => {
    const out = exportTokens(minimal, { name: 'main' })
    expect(out.files.base.name).toBe('main.tokens.json')
    expect(out.files.dark).toBeNull()
    expect(out.files.resolver).toBeNull()
    expect(out.files.base.document).toEqual({
      $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
      color: {
        primary: {
          $type: 'color',
          $value: {
            colorSpace: 'srgb',
            components: [0.309803921569, 0.274509803922, 0.898039215686],
            hex: '#4f46e5',
          },
        },
      },
      radius: { md: { $type: 'dimension', $value: { value: 0.5, unit: 'rem' } } },
    })
    expect(validateTokensFile(out.files.base.document).valid).toBe(true)
  })

  it('with dark colors adds a dark file and a resolver that names both files', () => {
    const out = exportTokens(
      { ...minimal, dark: { colors: { primary: '#818CF8' } } },
      { name: 'main' },
    )
    expect(out.files.dark?.name).toBe('main.dark.tokens.json')
    expect(out.files.resolver?.name).toBe('main.resolver.json')
    const resolver = out.files.resolver!.document
    expect(resolver).toMatchObject({
      version: '2025.10',
      sets: { base: { sources: [{ $ref: 'main.tokens.json' }] } },
      modifiers: {
        theme: {
          contexts: { light: [], dark: [{ $ref: 'main.dark.tokens.json' }] },
          default: 'light',
        },
      },
    })
    const result = validateResolverFile(resolver)
    expect(result.valid, result.errors.join('\n')).toBe(true)
    expect(validateTokensFile(out.files.dark!.document).valid).toBe(true)
  })

  it('omits what DTCG cannot represent and keeps the denominator (E6)', () => {
    const out = exportTokens(
      {
        colors: { primary: 'rgb(foo)', secondary: 'notacolor', text: 'var(--x)', surface: '#fff' },
        spacing: { sm: '1.5em', md: '12pt', lg: '1rem' },
      },
      { name: 'p' },
    )
    expect(out.report.omitted.map((e) => [e.path, e.code])).toEqual([
      ['colors.primary', 'color_channel'],
      ['colors.secondary', 'color_unsupported'],
      ['colors.text', 'color_var'],
      ['spacing.sm', 'length_unit'],
    ])
    expect(out.report.converted.map((e) => [e.path, e.target, e.code])).toEqual([
      ['spacing.md', 'spacing.md', 'unit_converted'],
    ])
    expect(out.report.total).toBe(7)
    expect(out.report.exported + out.report.omitted.length).toBe(out.report.total)
    // Omitted tokens are absent from the file, not present with a bad value.
    const doc = out.files.base.document as { color: Record<string, unknown> }
    expect(Object.keys(doc.color)).toEqual(['surface'])
    expect(validateTokensFile(out.files.base.document).valid).toBe(true)
  })

  it('never lets a key reach an object prototype while building groups', () => {
    const hostile = JSON.parse(
      '{"colors": {"__proto__": "#000", "constructor": "#111", "a.b": "#222"}}',
    ) as StudioTokens
    const out = exportTokens(hostile, { name: 'p' })
    expect(({} as Record<string, unknown>).$type).toBeUndefined()
    expect(out.report.omitted.map((e) => e.code)).toEqual([
      'invalid_name',
      'invalid_name',
      'invalid_name',
    ])
  })

  it('font slots: family + one fontWeight token per weight, Studio data as an extension', () => {
    const out = exportTokens(
      {
        typography: {
          fontFamily: { base: 'Inter, system-ui, sans-serif' },
          slots: {
            heading: {
              source: 'custom',
              family: 'Brand Grotesk',
              weights: [400, 700],
              files: { '400': 'fonts/brand-400.woff2', '700': 'fonts/brand-700.woff2' },
              fallbacks: ['system-grotesk'],
            },
          },
        },
        assets: { logo: { file: 'logo.svg', type: 'svg' } },
      },
      { name: 'p' },
    )
    const doc = out.files.base.document as Record<string, any>
    expect(doc.$extensions).toEqual({
      [EXTENSION_KEY]: { logo: { file: 'logo.svg', type: 'svg' } },
    })
    expect(doc.font.family.base.$value).toEqual(['Inter', 'system-ui', 'sans-serif'])
    expect(doc.font.heading.family).toEqual({
      $type: 'fontFamily',
      $value: 'Brand Grotesk',
      $extensions: {
        [EXTENSION_KEY]: {
          source: 'custom',
          fallbacks: ['system-grotesk'],
          files: { '400': 'fonts/brand-400.woff2', '700': 'fonts/brand-700.woff2' },
        },
      },
    })
    expect(doc.font.heading.weight['700']).toEqual({ $type: 'fontWeight', $value: 700 })
    expect(out.report).toMatchObject({ total: 4, exported: 4, omitted: [] })
    const result = validateTokensFile(out.files.base.document)
    expect(result.valid, result.errors.join('\n')).toBe(true)
  })

  it('file names come from a safe slug', () => {
    expect(exportTokens(minimal, { name: '../Evil Name' }).files.base.name).toBe(
      'evil-name.tokens.json',
    )
  })
})
