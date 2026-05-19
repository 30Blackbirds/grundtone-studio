// WCAG 2.1 contrast helpers.
//
// Token editor uses these to show a pass/fail badge next to color pairs that
// matter for accessibility (text-on-background, button-text-on-button, etc.).
// Pure functions, no DOM access — safe to call from any Vue component or test.
//
// References:
//   - https://www.w3.org/TR/WCAG21/#contrast-minimum  (AA: 4.5 normal / 3 large)
//   - https://www.w3.org/TR/WCAG21/#contrast-enhanced (AAA: 7 normal / 4.5 large)

export interface RGB {
  r: number // 0–255
  g: number
  b: number
}

export type WcagLevel = 'AAA' | 'AA' | 'AA-large' | 'fail'

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * Parse a CSS color string into RGB. Currently handles hex (3/6/8 digit) —
 * the editor's <input type="color"> only emits 6-digit hex, so this covers
 * the realistic input. Returns null for unparseable values (rgb(), hsl(),
 * named colors, var(--token)) so callers can render a neutral "—" instead
 * of a false-negative ratio.
 */
export function parseColor(input: string | undefined | null): RGB | null {
  if (!input) return null
  const v = input.trim()
  const match = HEX_RE.exec(v)
  if (!match) return null
  let hex = match[1]
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  } else if (hex.length === 8) {
    // Drop alpha — contrast is computed against the visible RGB.
    hex = hex.slice(0, 6)
  }
  const n = parseInt(hex, 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/**
 * Relative luminance per WCAG 2.1: converts sRGB to linear-light, then
 * applies the standard weighted sum. Output range 0 (black) – 1 (white).
 */
export function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (c8: number) => {
    const c = c8 / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Contrast ratio per WCAG 2.1 — (L1 + 0.05) / (L2 + 0.05) where L1 is the
 * lighter colour. Range: 1 (no contrast, same colour) – 21 (#000 vs #FFF).
 */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export interface WcagOptions {
  // 'normal' targets 4.5 / 7 thresholds; 'large' targets 3 / 4.5 (≥ 18pt or
  // ≥ 14pt bold). UI components and graphical objects also use 3:1 (WCAG 1.4.11).
  size?: 'normal' | 'large'
}

/**
 * Bucket a contrast ratio into a WCAG level. Returns:
 *   - 'AAA'      — passes the highest threshold for the given size
 *   - 'AA'       — passes the AA-normal threshold (4.5)
 *   - 'AA-large' — passes only the AA-large / non-text threshold (3.0)
 *   - 'fail'     — below 3.0
 */
export function wcagLevel(ratio: number, opts: WcagOptions = {}): WcagLevel {
  const size = opts.size ?? 'normal'
  if (size === 'large') {
    if (ratio >= 4.5) return 'AAA'
    if (ratio >= 3) return 'AA'
    return 'fail'
  }
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA-large'
  return 'fail'
}

/**
 * Convenience wrapper: parse two CSS color strings, compute their contrast
 * ratio, and bucket it. Returns null if either color can't be parsed.
 */
export function evaluatePair(
  fg: string | undefined | null,
  bg: string | undefined | null,
  opts: WcagOptions = {},
): { ratio: number; level: WcagLevel } | null {
  const a = parseColor(fg)
  const b = parseColor(bg)
  if (!a || !b) return null
  const ratio = contrastRatio(a, b)
  return { ratio, level: wcagLevel(ratio, opts) }
}
