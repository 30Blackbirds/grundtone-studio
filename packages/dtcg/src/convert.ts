import { NAMED_COLORS } from './named-colors'

// Conversions from the CSS strings Studio stores to DTCG 2025.10 values.
// Every function either returns a value or a reason; nothing throws, so one
// bad value never fails a whole export (E6).

/** Stable identifiers for report entries, so a UI can translate them. */
export type OmitCode =
  | 'color_var'
  | 'color_unsupported'
  | 'color_channel'
  | 'color_alpha'
  | 'length_not_number'
  | 'length_unitless'
  | 'length_unit'
  | 'font_family_empty'
  | 'font_family_quote'
  | 'invalid_name'
export type NoteCode = 'unit_converted' | 'unitless_zero' | 'named_color' | 'hue_normalised'

export type Conversion<T> =
  | { ok: true; value: T; note?: { code: NoteCode; text: string } }
  | { ok: false; code: OmitCode; reason: string }

export interface DtcgColor {
  colorSpace: 'srgb' | 'hsl'
  components: [number, number, number]
  alpha?: number
  hex: string
}

export interface DtcgDimension {
  value: number
  unit: 'px' | 'rem'
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

function parseNumber(raw: string): number | null {
  return NUMBER.test(raw) ? Number(raw) : null
}

// Float noise from unit arithmetic (0.1 * 3) without rounding away precision
// a designer entered.
function clean(n: number): number {
  return Number(n.toPrecision(12))
}

function toHexByte(n: number): string {
  return Math.round(n * 255)
    .toString(16)
    .padStart(2, '0')
}

function hexOf(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
}

function withAlpha(color: DtcgColor, alpha: number): DtcgColor {
  return alpha < 1 ? { ...color, alpha: clean(Math.round(alpha * 10000) / 10000) } : color
}

function fromHex(input: string): Conversion<DtcgColor> {
  let digits = input.slice(1).toLowerCase()
  if (digits.length === 3 || digits.length === 4) {
    digits = [...digits].map((c) => c + c).join('')
  }
  const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255
  const [r, g, b] = [byte(0), byte(2), byte(4)]
  const color: DtcgColor = {
    colorSpace: 'srgb',
    components: [clean(r), clean(g), clean(b)],
    hex: `#${digits.slice(0, 6)}`,
  }
  return { ok: true, value: digits.length === 8 ? withAlpha(color, byte(6)) : color }
}

// Arguments of rgb()/hsl() in either the legacy comma syntax or the modern
// space syntax with an optional `/ alpha`.
function splitArgs(inner: string): { channels: string[]; alpha: string | null } | null {
  const trimmed = inner.trim()
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((p) => p.trim())
    if (parts.length !== 3 && parts.length !== 4) return null
    return { channels: parts.slice(0, 3), alpha: parts[3] ?? null }
  }
  const [main, alpha, extra] = trimmed.split('/').map((p) => p.trim())
  if (extra !== undefined || !main) return null
  const channels = main.split(/\s+/)
  if (channels.length !== 3) return null
  return { channels, alpha: alpha ?? null }
}

function parseAlpha(raw: string | null): number | null {
  if (raw === null) return 1
  const value = raw.endsWith('%') ? parseNumber(raw.slice(0, -1)) : parseNumber(raw)
  if (value === null) return null
  const alpha = raw.endsWith('%') ? value / 100 : value
  return alpha >= 0 && alpha <= 1 ? alpha : null
}

function fromRgb(inner: string): Conversion<DtcgColor> {
  const args = splitArgs(inner)
  if (!args)
    return {
      ok: false,
      code: 'color_channel',
      reason: 'rgb() needs three channels and an optional alpha',
    }
  const channels: number[] = []
  for (const raw of args.channels) {
    const percent = raw.endsWith('%')
    const n = parseNumber(percent ? raw.slice(0, -1) : raw)
    if (n === null)
      return { ok: false, code: 'color_channel', reason: `rgb() channel "${raw}" is not a number` }
    const unit = percent ? n / 100 : n / 255
    if (unit < 0 || unit > 1)
      return { ok: false, code: 'color_channel', reason: `rgb() channel "${raw}" is out of range` }
    channels.push(unit)
  }
  const alpha = parseAlpha(args.alpha)
  if (alpha === null)
    return { ok: false, code: 'color_alpha', reason: `alpha "${args.alpha}" is not in 0–1` }
  const [r, g, b] = channels as [number, number, number]
  const color: DtcgColor = {
    colorSpace: 'srgb',
    components: [clean(r), clean(g), clean(b)],
    hex: hexOf(r, g, b),
  }
  return { ok: true, value: withAlpha(color, alpha) }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  // CSS Color 4 §7.1 reference algorithm; s and l in 0–1.
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

function fromHsl(inner: string): Conversion<DtcgColor> {
  const args = splitArgs(inner)
  if (!args)
    return {
      ok: false,
      code: 'color_channel',
      reason: 'hsl() needs three channels and an optional alpha',
    }
  const [hueRaw, satRaw, lightRaw] = args.channels as [string, string, string]
  const hue = parseNumber(hueRaw.endsWith('deg') ? hueRaw.slice(0, -3) : hueRaw)
  if (hue === null)
    return {
      ok: false,
      code: 'color_channel',
      reason: `hsl() hue "${hueRaw}" is not a number of degrees`,
    }
  const percent = (raw: string) => parseNumber(raw.endsWith('%') ? raw.slice(0, -1) : raw)
  const sat = percent(satRaw)
  const light = percent(lightRaw)
  if (sat === null || sat < 0 || sat > 100 || light === null || light < 0 || light > 100) {
    return {
      ok: false,
      code: 'color_channel',
      reason: 'hsl() saturation and lightness must be 0–100%',
    }
  }
  const alpha = parseAlpha(args.alpha)
  if (alpha === null)
    return { ok: false, code: 'color_alpha', reason: `alpha "${args.alpha}" is not in 0–1` }
  // DTCG hue is [0, 360); CSS accepts any angle and wraps it.
  const h = clean(((hue % 360) + 360) % 360)
  const [r, g, b] = hslToRgb(h, sat / 100, light / 100)
  const color: DtcgColor = {
    colorSpace: 'hsl',
    components: [h, clean(sat), clean(light)],
    hex: hexOf(r, g, b),
  }
  return {
    ok: true,
    value: withAlpha(color, alpha),
    ...(h !== hue
      ? { note: { code: 'hue_normalised' as const, text: `hue ${hue} normalised to ${h}` } }
      : {}),
  }
}

/** A CSS color string as stored by Studio → a DTCG color value. */
export function cssColorToDtcg(input: string): Conversion<DtcgColor> {
  const value = input.trim()
  const lower = value.toLowerCase()
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return fromHex(value)
  const fn = /^(rgba?|hsla?)\((.*)\)$/i.exec(value)
  if (fn) {
    const name = fn[1]!.toLowerCase()
    return name.startsWith('rgb') ? fromRgb(fn[2]!) : fromHsl(fn[2]!)
  }
  if (lower.startsWith('var(')) {
    return {
      ok: false,
      code: 'color_var',
      reason: 'a var() reference has no fixed color to export',
    }
  }
  if (lower === 'transparent') {
    return {
      ok: true,
      value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0, hex: '#000000' },
    }
  }
  const named = NAMED_COLORS.get(lower)
  if (named) {
    const result = fromHex(named)
    return result.ok
      ? { ...result, note: { code: 'named_color', text: `named color ${lower}` } }
      : result
  }
  return {
    ok: false,
    code: 'color_unsupported',
    reason: 'not a CSS color this export can represent',
  }
}

// CSS Values 4 §6.2: absolute units have fixed ratios to px (O5).
const ABSOLUTE_TO_PX: Record<string, number> = {
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
  pc: 16,
}

/** A CSS length string as stored by Studio → a DTCG dimension value. */
export function cssLengthToDtcg(input: string): Conversion<DtcgDimension> {
  const match = /^(.*?)([a-z%]*)$/i.exec(input.trim())
  const n = match ? parseNumber(match[1]!) : null
  const unit = match?.[2]?.toLowerCase() ?? ''
  if (n === null) return { ok: false, code: 'length_not_number', reason: 'not a number' }
  if (unit === 'px' || unit === 'rem') return { ok: true, value: { value: n, unit } }
  if (unit === '') {
    return n === 0
      ? {
          ok: true,
          value: { value: 0, unit: 'px' },
          note: { code: 'unitless_zero', text: 'unitless 0 exported as 0px' },
        }
      : {
          ok: false,
          code: 'length_unitless',
          reason: 'a unitless length other than 0 has no DTCG unit',
        }
  }
  const ratio = ABSOLUTE_TO_PX[unit]
  if (ratio !== undefined) {
    return {
      ok: true,
      value: { value: clean(n * ratio), unit: 'px' },
      note: { code: 'unit_converted', text: `${unit} converted to px` },
    }
  }
  return {
    ok: false,
    code: 'length_unit',
    reason: `DTCG dimensions support px and rem only, not ${unit}`,
  }
}

/**
 * A CSS font-family list → a DTCG fontFamily value: one name as a string,
 * several as an array. Quotes are removed; commas inside quotes are kept.
 */
export function cssFontFamilyToDtcg(input: string): Conversion<string | string[]> {
  const names: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ',') {
      names.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (quote)
    return { ok: false, code: 'font_family_quote', reason: 'unterminated quote in font-family' }
  names.push(current)
  const cleaned = names.map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean)
  if (cleaned.length === 0)
    return { ok: false, code: 'font_family_empty', reason: 'empty font-family' }
  return { ok: true, value: cleaned.length === 1 ? cleaned[0]! : cleaned }
}
