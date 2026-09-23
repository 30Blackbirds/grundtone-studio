import { parseDocument, type ParseError, type ParsedToken } from './parse'
import { EXTENSION_KEY, type StudioFontSlot, type StudioTokens } from './export'

// DTCG 2025.10 → Studio tokens (riff KH-1044, part B). The inverse of export.ts,
// and deliberately NOT a validator: the result is handed to Studio's own
// tokensSchema, which stays the only thing that decides what may be saved (O3).
//
// 🔴 The curated font lists are INPUT, not a copy. They live in
// apps/studio/server/lib/tokens.ts, and duplicating them here would create a
// second truth that drifts the day a font is added. The app passes its own.

// 🔴 THE TYPES STUDIO CAN MAP — load-bearing, not documentation. Every token
// whose $type is outside this set is reported as not-mapped before any path
// matching, so the set is what actually decides. It is also the denominator the
// KH-1179 guard watches: the five composite sub-value fixtures that neither the
// parser nor the official schema rejects are harmless ONLY while composite
// types cannot be mapped. The day a fifth type is added here, that stops being
// true, and a cell in parse.test.ts fails for exactly that reason rather than
// letting the gap go live in silence.
export const MAPPED_TYPES: ReadonlySet<string> = new Set([
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
])

export type ImportCode =
  | 'mapped'
  | 'unknown_path'
  | 'unsupported_type'
  | 'color_space'
  | 'color_shape'
  | 'dimension_unit'
  | 'dimension_negative'
  | 'dimension_shape'
  | 'font_family_shape'
  | 'font_not_curated'
  | 'font_weight_not_curated'
  | 'font_weight_shape'
  | 'font_custom_slot'
  | 'parse_error'
  | 'color_converted'
  | 'hue_normalised'

export interface ImportEntry {
  code: ImportCode
  /** Path in the DTCG document, e.g. `color.primary`. */
  path: string
  /** Studio path it landed on, when it did. */
  studioPath?: string
  value: string
  reason: string
}

export interface ImportReport {
  /** Tokens in the file(s): mapped + converted + notMapped + invalid. */
  total: number
  mapped: ImportEntry[]
  /** Mapped, but the value was changed on the way. */
  converted: ImportEntry[]
  /** Outside Studio's model: a foreign path or a type Studio has no slot for. */
  notMapped: ImportEntry[]
  /** Meant for a Studio slot, but the value cannot be represented there. */
  invalid: ImportEntry[]
  /** Not-mapped tokens counted per top-level path — counts, never values (O1). */
  notMappedByPrefix: Record<string, number>
  /** Dropped $extensions keys per vendor, so the loss is visible (I9). */
  droppedExtensions: Record<string, string[]>
  /** Structural errors from the parser; a file with these imports nothing. */
  parseErrors: ParseError[]
  /** Existing draft values this import would overwrite (I4). */
  overwritten: number
}

export interface ImportOptions {
  /** family → the weights Studio curates for it. */
  curatedFonts: Record<string, readonly number[]>
  /** The draft as it is today, to count overwrites and to merge onto (I4). */
  current?: StudioTokens
}

export interface ImportResult {
  tokens: StudioTokens
  report: ImportReport
}

interface DtcgColorValue {
  colorSpace: string
  components: number[]
  alpha?: number
  hex?: string
}

function clean(n: number): number {
  return Number(n.toPrecision(12))
}

function hexByte(n: number): string {
  return Math.round(Math.min(1, Math.max(0, n)) * 255)
    .toString(16)
    .padStart(2, '0')
}

/** A DTCG color → the CSS string Studio stores. */
export function dtcgColorToCss(
  value: DtcgColorValue,
): { ok: true; css: string; note?: string } | { ok: false; code: ImportCode; reason: string } {
  const alpha = typeof value.alpha === 'number' ? value.alpha : 1
  const [a, b, c] = value.components
  if (![a, b, c].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { ok: false, code: 'color_shape', reason: 'components must be three numbers' }
  }
  if (value.colorSpace === 'srgb') {
    const hex = `#${hexByte(a!)}${hexByte(b!)}${hexByte(c!)}`
    return { ok: true, css: alpha < 1 ? `${hex}${hexByte(alpha)}` : hex }
  }
  if (value.colorSpace === 'hsl') {
    const [h, s, l] = [clean(a!), clean(b!), clean(c!)]
    return {
      ok: true,
      css: alpha < 1 ? `hsla(${h}, ${s}%, ${l}%, ${clean(alpha)})` : `hsl(${h}, ${s}%, ${l}%)`,
    }
  }
  // Any other color space: the file's own hex fallback, or nothing. No gamut
  // mapping — a converted value the designer never chose would be worse than a
  // visible refusal (I7).
  if (typeof value.hex === 'string' && /^#[0-9a-f]{6}$/i.test(value.hex)) {
    return {
      ok: true,
      css: alpha < 1 ? `${value.hex}${hexByte(alpha)}` : value.hex,
      note: `${value.colorSpace} taken from the file's hex fallback`,
    }
  }
  return {
    ok: false,
    code: 'color_space',
    reason: `color space "${value.colorSpace}" has no hex fallback in the file`,
  }
}

/** A DTCG dimension → the CSS length Studio stores. */
export function dtcgDimensionToCss(
  value: unknown,
): { ok: true; css: string } | { ok: false; code: ImportCode; reason: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { value?: unknown }).value !== 'number' ||
    typeof (value as { unit?: unknown }).unit !== 'string'
  ) {
    return { ok: false, code: 'dimension_shape', reason: 'a dimension needs a value and a unit' }
  }
  const { value: n, unit } = value as { value: number; unit: string }
  if (unit !== 'px' && unit !== 'rem') {
    return { ok: false, code: 'dimension_unit', reason: `Studio stores px and rem, not ${unit}` }
  }
  if (n < 0) {
    // Measured on Studio's schema: the pattern rejects a leading minus.
    return {
      ok: false,
      code: 'dimension_negative',
      reason: 'Studio does not accept a negative length',
    }
  }
  return { ok: true, css: `${clean(n)}${unit}` }
}

function familyToCss(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((v) => typeof v === 'string') && value.length > 0) {
    return value.join(', ')
  }
  return null
}

class Importer {
  readonly report: ImportReport = {
    total: 0,
    mapped: [],
    converted: [],
    notMapped: [],
    invalid: [],
    notMappedByPrefix: {},
    droppedExtensions: {},
    parseErrors: [],
    overwritten: 0,
  }
  readonly tokens: StudioTokens = {}
  /** family/weights collected per slot before they can be checked together. */
  readonly slots = new Map<string, { family?: string; weights: number[]; source?: string }>()

  constructor(readonly options: ImportOptions) {}

  private entry(
    list: ImportEntry[],
    code: ImportCode,
    token: ParsedToken,
    reason: string,
    studioPath?: string,
  ): void {
    list.push({
      code,
      path: token.path.join('.'),
      ...(studioPath ? { studioPath } : {}),
      value: JSON.stringify(token.value) ?? '',
      reason,
    })
  }

  notMapped(token: ParsedToken, code: ImportCode, reason: string): void {
    this.entry(this.report.notMapped, code, token, reason)
    const prefix = token.path[0] ?? '(root)'
    this.report.notMappedByPrefix[prefix] = (this.report.notMappedByPrefix[prefix] ?? 0) + 1
  }

  invalid(token: ParsedToken, code: ImportCode, reason: string, studioPath?: string): void {
    this.entry(this.report.invalid, code, token, reason, studioPath)
  }

  mapped(token: ParsedToken, studioPath: string, note?: string): void {
    this.entry(this.report.mapped, 'mapped', token, 'mapped', studioPath)
    if (note) {
      this.entry(this.report.converted, 'color_converted', token, note, studioPath)
    }
  }

  dropExtensions(token: ParsedToken): void {
    for (const vendor of Object.keys(token.extensions ?? {})) {
      const keys = this.report.droppedExtensions[vendor] ?? []
      if (!keys.includes(token.path.join('.'))) keys.push(token.path.join('.'))
      this.report.droppedExtensions[vendor] = keys
    }
  }
}

function setColor(tokens: StudioTokens, dark: boolean, slot: string, css: string): void {
  if (dark) {
    tokens.dark ??= {}
    tokens.dark.colors ??= {}
    tokens.dark.colors[slot] = css
  } else {
    tokens.colors ??= {}
    tokens.colors[slot] = css
  }
}

/**
 * Map one parsed document onto the Studio shape. `dark` decides whether colors
 * land in `colors` or in `dark.colors`; everything else is only read from the
 * base file, because the dark file in our own export carries colors alone.
 */
function mapTokens(imp: Importer, tokens: ParsedToken[], dark: boolean): void {
  for (const token of tokens) {
    imp.report.total++
    imp.dropExtensions(token)
    if (!MAPPED_TYPES.has(token.type)) {
      imp.notMapped(token, 'unsupported_type', `Studio has no slot for a ${token.type} token`)
      continue
    }
    const [head, ...rest] = token.path

    // colors: `color.<slot>` — the convention export.ts writes.
    if (head === 'color' && rest.length === 1) {
      if (token.type !== 'color') {
        imp.notMapped(token, 'unsupported_type', `a ${token.type} token cannot be a Studio color`)
        continue
      }
      const css = dtcgColorToCss(token.value as DtcgColorValue)
      if (!css.ok) {
        imp.invalid(token, css.code, css.reason, `${dark ? 'dark.colors' : 'colors'}.${rest[0]}`)
        continue
      }
      setColor(imp.tokens, dark, rest[0]!, css.css)
      imp.mapped(token, `${dark ? 'dark.colors' : 'colors'}.${rest[0]}`, css.note)
      continue
    }

    if (dark) {
      imp.notMapped(token, 'unknown_path', 'the dark file carries colors only')
      continue
    }

    // radius / spacing: `<group>.<key>`.
    if ((head === 'radius' || head === 'spacing') && rest.length === 1) {
      if (token.type !== 'dimension') {
        imp.notMapped(token, 'unsupported_type', `a ${token.type} token cannot be a ${head} value`)
        continue
      }
      const css = dtcgDimensionToCss(token.value)
      if (!css.ok) {
        imp.invalid(token, css.code, css.reason, `${head}.${rest[0]}`)
        continue
      }
      imp.tokens[head] ??= {}
      imp.tokens[head]![rest[0]!] = css.css
      imp.mapped(token, `${head}.${rest[0]}`)
      continue
    }

    // typography.fontFamily: `font.family.<base|heading|mono>`.
    if (head === 'font' && rest[0] === 'family' && rest.length === 2) {
      const key = rest[1]!
      if (!['base', 'heading', 'mono'].includes(key)) {
        imp.notMapped(token, 'unknown_path', `Studio has no font family slot "${key}"`)
        continue
      }
      const family = familyToCss(token.value)
      if (family === null) {
        imp.invalid(
          token,
          'font_family_shape',
          'not a font family name or list',
          `typography.fontFamily.${key}`,
        )
        continue
      }
      imp.tokens.typography ??= {}
      imp.tokens.typography.fontFamily ??= {}
      ;(imp.tokens.typography.fontFamily as Record<string, string>)[key] = family
      imp.mapped(token, `typography.fontFamily.${key}`)
      continue
    }

    // font slots: `font.<heading|body>.family` and `font.<…>.weight.<n>`.
    if (head === 'font' && (rest[0] === 'heading' || rest[0] === 'body')) {
      const name = rest[0]
      const slot = imp.slots.get(name) ?? { weights: [] }
      imp.slots.set(name, slot)
      if (rest[1] === 'family' && rest.length === 2) {
        const family = familyToCss(token.value)
        if (family === null) {
          imp.invalid(
            token,
            'font_family_shape',
            'not a font family name or list',
            `typography.slots.${name}.family`,
          )
          continue
        }
        slot.family = family
        const source = (token.extensions?.[EXTENSION_KEY] as { source?: string } | undefined)
          ?.source
        slot.source = source
        imp.mapped(token, `typography.slots.${name}.family`)
        continue
      }
      if (rest[1] === 'weight' && rest.length === 3) {
        const weight = typeof token.value === 'number' ? token.value : Number(token.value)
        if (!Number.isFinite(weight)) {
          imp.invalid(
            token,
            'font_weight_shape',
            'not a numeric weight',
            `typography.slots.${name}.weights`,
          )
          continue
        }
        slot.weights.push(weight)
        imp.mapped(token, `typography.slots.${name}.weights`)
        continue
      }
    }

    imp.notMapped(token, 'unknown_path', 'outside the paths a Studio export writes')
  }
}

// A slot is only accepted as CURATED: a custom slot needs uploaded woff2 files,
// which cannot come from JSON (I8). The family and the weights are checked
// together, because a curated family with a weight it does not have is not a
// slot Studio can store.
function finishSlots(imp: Importer): void {
  for (const [name, slot] of imp.slots) {
    const studioPath = `typography.slots.${name}`
    const token = { path: [studioPath], type: 'fontFamily', value: slot.family, raw: slot.family }
    if (slot.source === 'custom') {
      imp.notMapped(
        token as ParsedToken,
        'font_custom_slot',
        'a custom font slot needs uploaded woff2 files',
      )
      continue
    }
    const curated = slot.family ? imp.options.curatedFonts[slot.family] : undefined
    if (!slot.family || !curated) {
      imp.notMapped(
        token as ParsedToken,
        'font_not_curated',
        `"${slot.family ?? '(no family)'}" is not one of Studio's curated fonts`,
      )
      continue
    }
    const unavailable = slot.weights.filter((w) => !curated.includes(w))
    if (unavailable.length > 0) {
      imp.invalid(
        token as ParsedToken,
        'font_weight_not_curated',
        `weights ${unavailable.join(', ')} are not curated for ${slot.family}`,
        studioPath,
      )
      continue
    }
    imp.tokens.typography ??= {}
    imp.tokens.typography.slots ??= {}
    const value: StudioFontSlot = {
      source: 'curated',
      family: slot.family,
      weights: [...new Set(slot.weights)].sort((a, b) => a - b),
      fallbacks: [],
    }
    ;(imp.tokens.typography.slots as Record<string, StudioFontSlot>)[name] = value
  }
}

/** Count the values in `current` that this import would replace (I4). */
function countOverwrites(next: StudioTokens, current: StudioTokens | undefined): number {
  if (!current) return 0
  let n = 0
  const maps: [
    Record<string, string | undefined> | undefined,
    Record<string, string | undefined> | undefined,
  ][] = [
    [next.colors, current.colors],
    [next.radius, current.radius],
    [next.spacing, current.spacing],
    [next.dark?.colors, current.dark?.colors],
    [
      next.typography?.fontFamily as Record<string, string> | undefined,
      current.typography?.fontFamily as Record<string, string> | undefined,
    ],
  ]
  for (const [a, b] of maps) {
    for (const key of Object.keys(a ?? {})) {
      if (b && b[key] !== undefined && b[key] !== (a as Record<string, string>)[key]) n++
    }
  }
  for (const name of ['heading', 'body'] as const) {
    if (next.typography?.slots?.[name] && current.typography?.slots?.[name]) n++
  }
  return n
}

/**
 * Import one base document and an optional dark document. Nothing is written
 * and nothing is validated here: the caller hands `tokens` to Studio's
 * tokensSchema and saves it as a DRAFT (I3).
 */
export function importTokens(
  base: unknown,
  dark: unknown | null,
  options: ImportOptions,
): ImportResult {
  const imp = new Importer(options)
  const parsedBase = parseDocument(base)
  imp.report.parseErrors.push(...parsedBase.errors)
  const parsedDark = dark == null ? null : parseDocument(dark)
  if (parsedDark) imp.report.parseErrors.push(...parsedDark.errors)

  // A structurally broken file imports NOTHING. Half a token set is worse than
  // a refusal: the user would have to find what was skipped.
  if (imp.report.parseErrors.length > 0) {
    return { tokens: {}, report: imp.report }
  }

  mapTokens(imp, parsedBase.tokens, false)
  if (parsedDark) mapTokens(imp, parsedDark.tokens, true)
  finishSlots(imp)
  imp.report.overwritten = countOverwrites(imp.tokens, options.current)
  return { tokens: imp.tokens, report: imp.report }
}
