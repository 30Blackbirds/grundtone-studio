import { describe, it, expect } from 'vitest'
import { exportTokens, type StudioTokens } from './export'
import { importTokens, dtcgColorToCss, dtcgDimensionToCss } from './import'
import { validateTokensFile } from './testing/validate'

// The centre of this file is a ROUND TRIP: Studio tokens → export → import →
// Studio tokens. It is the one cell that cannot pass by agreeing with itself,
// because the two directions were written against the spec, not against each
// other, and part A's exporter is already pinned by its own cells and by the
// official schema.

const CURATED = { Inter: [400, 600, 700], 'JetBrains Mono': [400, 700] }

const FULL: StudioTokens = {
  colors: { primary: '#3366ff', surface: '#ffffff', muted: '#00000080' },
  radius: { sm: '4px', lg: '1.5rem' },
  spacing: { xs: '2px', md: '16px' },
  typography: {
    fontFamily: { base: 'Inter, sans-serif', heading: 'Inter', mono: 'JetBrains Mono' },
    slots: {
      heading: { source: 'curated', family: 'Inter', weights: [400, 700], fallbacks: [] },
    },
  },
  dark: { colors: { primary: '#99bbff', surface: '#101014' } },
}

function roundTrip(tokens: StudioTokens, current?: StudioTokens) {
  const exported = exportTokens(tokens, { name: 'demo' })
  return importTokens(exported.files.base.document, exported.files.dark?.document ?? null, {
    curatedFonts: CURATED,
    ...(current ? { current } : {}),
  })
}

describe('round trip: Studio → DTCG → Studio', () => {
  it('returns every colour, radius, spacing and family unchanged', () => {
    const { tokens, report } = roundTrip(FULL)
    expect(report.parseErrors).toEqual([])
    expect(tokens.colors).toEqual(FULL.colors)
    expect(tokens.radius).toEqual(FULL.radius)
    expect(tokens.spacing).toEqual(FULL.spacing)
    expect(tokens.typography?.fontFamily).toEqual(FULL.typography?.fontFamily)
    expect(tokens.dark?.colors).toEqual(FULL.dark?.colors)
  })

  it('returns the curated font slot, weights and all', () => {
    const { tokens } = roundTrip(FULL)
    expect(tokens.typography?.slots?.heading).toEqual({
      source: 'curated',
      family: 'Inter',
      weights: [400, 700],
      fallbacks: [],
    })
  })

  it('the document it round-trips through is valid per the official schema', () => {
    // Otherwise the round trip could be green over a file no one else accepts.
    const exported = exportTokens(FULL, { name: 'demo' })
    expect(validateTokensFile(exported.files.base.document).valid).toBe(true)
    expect(validateTokensFile(exported.files.dark!.document).valid).toBe(true)
  })

  it('reports every token in exactly one category, summing to the total', () => {
    const { report } = roundTrip(FULL)
    expect(report.total).toBe(
      report.mapped.length + report.notMapped.length + report.invalid.length,
    )
    expect(report.total).toBeGreaterThan(0)
    // `converted` is a note ON a mapped token, not a fifth bucket.
    expect(report.converted.every((c) => report.mapped.some((m) => m.path === c.path))).toBe(true)
  })
})

describe('values Studio cannot store', () => {
  it('refuses a negative dimension, because the schema pattern does', () => {
    const result = dtcgDimensionToCss({ value: -4, unit: 'px' })
    expect(result).toEqual({
      ok: false,
      code: 'dimension_negative',
      reason: 'Studio does not accept a negative length',
    })
  })

  it('refuses a unit Studio does not store, and names it', () => {
    expect(dtcgDimensionToCss({ value: 2, unit: 'em' })).toMatchObject({
      ok: false,
      code: 'dimension_unit',
    })
  })

  it('takes the hex fallback for an unknown colour space, and says it converted', () => {
    const out = dtcgColorToCss({ colorSpace: 'display-p3', components: [1, 0, 0], hex: '#ff0000' })
    expect(out).toMatchObject({ ok: true, css: '#ff0000' })
    expect((out as { note: string }).note).toContain('display-p3')
  })

  it('refuses an unknown colour space with no fallback rather than guessing', () => {
    expect(dtcgColorToCss({ colorSpace: 'display-p3', components: [1, 0, 0] })).toMatchObject({
      ok: false,
      code: 'color_space',
    })
  })

  it('keeps alpha as an 8-digit hex', () => {
    expect(dtcgColorToCss({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 })).toMatchObject(
      {
        css: '#00000080',
      },
    )
  })
})

describe('the report says what was lost', () => {
  const document = {
    $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
    color: { primary: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } } },
    spacing: { neg: { $type: 'dimension', $value: { value: -4, unit: 'px' } } },
    elevation: {
      card: {
        $type: 'shadow',
        $value: {
          color: { colorSpace: 'srgb', components: [0, 0, 0] },
          offsetX: { value: 0, unit: 'px' },
          offsetY: { value: 1, unit: 'px' },
          blur: { value: 2, unit: 'px' },
          spread: { value: 0, unit: 'px' },
        },
      },
    },
    motion: { fast: { $type: 'duration', $value: { value: 100, unit: 'ms' } } },
  }

  it('splits foreign paths, unsupported types and unstorable values', () => {
    const { tokens, report } = importTokens(document, null, { curatedFonts: CURATED })
    expect(tokens.colors).toEqual({ primary: '#000000' })
    expect(report.mapped.map((e) => e.studioPath)).toEqual(['colors.primary'])
    expect(report.invalid.map((e) => e.code)).toEqual(['dimension_negative'])
    expect(report.notMapped.map((e) => e.path).sort()).toEqual(['elevation.card', 'motion.fast'])
    expect(report.total).toBe(4)
  })

  it('counts not-mapped tokens per top-level path, as counts and not values (O1)', () => {
    const { report } = importTokens(document, null, { curatedFonts: CURATED })
    expect(report.notMappedByPrefix).toEqual({ elevation: 1, motion: 1 })
  })

  it('lists dropped $extensions per vendor, so the loss is visible (I9)', () => {
    const withExt = {
      ...document,
      color: {
        primary: {
          $type: 'color',
          $value: { colorSpace: 'srgb', components: [0, 0, 0] },
          $extensions: { 'com.example.tool': { note: 'kept elsewhere' } },
        },
      },
    }
    const { report } = importTokens(withExt, null, { curatedFonts: CURATED })
    expect(report.droppedExtensions).toEqual({ 'com.example.tool': ['color.primary'] })
  })

  it('imports NOTHING from a structurally broken file', () => {
    const broken = { color: { primary: { $type: 'color', $value: '{nowhere}' } } }
    const { tokens, report } = importTokens(broken, null, { curatedFonts: CURATED })
    expect(tokens).toEqual({})
    expect(report.parseErrors[0]?.code).toBe('alias_unresolved')
    expect(report.total).toBe(0)
  })
})

describe('font slots are curated-only (I8)', () => {
  const slotDoc = (family: unknown, weights: number[], source?: string) => ({
    font: {
      [`heading`]: {
        family: {
          $type: 'fontFamily',
          $value: family,
          ...(source
            ? { $extensions: { 'dk.klanghaus.grundtone-studio': { source, fallbacks: [] } } }
            : {}),
        },
        weight: Object.fromEntries(
          weights.map((w) => [String(w), { $type: 'fontWeight', $value: w }]),
        ),
      },
    },
  })

  it('accepts a curated family with curated weights', () => {
    const { tokens } = importTokens(slotDoc('Inter', [400, 700]), null, { curatedFonts: CURATED })
    expect(tokens.typography?.slots?.heading).toMatchObject({
      family: 'Inter',
      weights: [400, 700],
    })
  })

  it('does not map a family Studio does not curate', () => {
    const { tokens, report } = importTokens(slotDoc('Comic Sans MS', [400]), null, {
      curatedFonts: CURATED,
    })
    expect(tokens.typography?.slots?.heading).toBeUndefined()
    expect(report.notMapped.some((e) => e.code === 'font_not_curated')).toBe(true)
  })

  it('rejects a weight the curated family does not have, naming it', () => {
    const { report } = importTokens(slotDoc('Inter', [400, 900]), null, { curatedFonts: CURATED })
    expect(report.invalid.some((e) => e.code === 'font_weight_not_curated')).toBe(true)
    expect(report.invalid[0]!.reason).toContain('900')
  })

  it('does not map a custom slot: woff2 files cannot come from JSON', () => {
    const { report } = importTokens(slotDoc('Inter', [400], 'custom'), null, {
      curatedFonts: CURATED,
    })
    expect(report.notMapped.some((e) => e.code === 'font_custom_slot')).toBe(true)
  })
})

describe('merge semantics (I4)', () => {
  it('counts the existing values it would overwrite', () => {
    const current: StudioTokens = {
      colors: { primary: '#ff0000', extra: '#00ff00' },
      radius: { sm: '4px' },
    }
    const { report } = roundTrip(FULL, current)
    // primary changes; radius.sm is identical, so it is not an overwrite.
    expect(report.overwritten).toBe(1)
  })

  it('returns only what the file carried, so slots outside it stay untouched', () => {
    const { tokens } = importTokens(
      {
        color: {
          primary: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } },
        },
      },
      null,
      { curatedFonts: CURATED, current: { colors: { primary: '#fff', other: '#000' } } },
    )
    expect(tokens.colors).toEqual({ primary: '#000000' })
    expect(tokens.colors!.other).toBeUndefined()
  })
})
