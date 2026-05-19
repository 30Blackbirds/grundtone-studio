import { describe, it, expect } from 'vitest'
import { contrastRatio, evaluatePair, parseColor, relativeLuminance, wcagLevel } from './contrast'

describe('parseColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseColor('#4F46E5')).toEqual({ r: 0x4f, g: 0x46, b: 0xe5 })
  })

  it('parses lowercase + tolerates whitespace', () => {
    expect(parseColor('  #4f46e5  ')).toEqual({ r: 0x4f, g: 0x46, b: 0xe5 })
  })

  it('expands 3-digit shorthand to 6-digit', () => {
    expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#F00')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
  })

  it('drops the alpha channel from 8-digit hex', () => {
    expect(parseColor('#4F46E580')).toEqual({ r: 0x4f, g: 0x46, b: 0xe5 })
  })

  it('returns null for non-hex colors (rgb, hsl, named, var)', () => {
    expect(parseColor('rgb(0,0,0)')).toBeNull()
    expect(parseColor('hsl(0,0%,0%)')).toBeNull()
    expect(parseColor('red')).toBeNull()
    expect(parseColor('var(--primary)')).toBeNull()
  })

  it('returns null for empty or malformed inputs', () => {
    expect(parseColor('')).toBeNull()
    expect(parseColor(null)).toBeNull()
    expect(parseColor(undefined)).toBeNull()
    expect(parseColor('#zzz')).toBeNull()
    expect(parseColor('#1234')).toBeNull() // 4 digits — not a valid hex length
  })
})

describe('relativeLuminance', () => {
  it('returns 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6)
  })

  it('weights green channel highest (per WCAG sRGB → linear formula)', () => {
    // Pure green dominates the weighted sum vs pure red or blue.
    const green = relativeLuminance({ r: 0, g: 255, b: 0 })
    const red = relativeLuminance({ r: 255, g: 0, b: 0 })
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 })
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })
})

describe('contrastRatio', () => {
  it('returns 21 for black vs white (the max)', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1)
  })

  it('returns 1 when both colors are identical (the min)', () => {
    expect(contrastRatio({ r: 100, g: 100, b: 100 }, { r: 100, g: 100, b: 100 })).toBeCloseTo(1, 6)
  })

  it('is symmetric — order doesnt matter', () => {
    const a = { r: 0x4f, g: 0x46, b: 0xe5 }
    const b = { r: 0xff, g: 0xff, b: 0xff }
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 6)
  })
})

describe('wcagLevel — normal text', () => {
  it('returns AAA for ratios >= 7', () => {
    expect(wcagLevel(21)).toBe('AAA')
    expect(wcagLevel(7)).toBe('AAA')
  })

  it('returns AA for ratios in [4.5, 7)', () => {
    expect(wcagLevel(4.5)).toBe('AA')
    expect(wcagLevel(6.99)).toBe('AA')
  })

  it('returns AA-large for ratios in [3, 4.5)', () => {
    expect(wcagLevel(3)).toBe('AA-large')
    expect(wcagLevel(4.49)).toBe('AA-large')
  })

  it('returns fail for ratios < 3', () => {
    expect(wcagLevel(2.99)).toBe('fail')
    expect(wcagLevel(1)).toBe('fail')
  })
})

describe('wcagLevel — large text', () => {
  it('lowers the AAA threshold to 4.5 and AA to 3', () => {
    expect(wcagLevel(4.5, { size: 'large' })).toBe('AAA')
    expect(wcagLevel(3, { size: 'large' })).toBe('AA')
    expect(wcagLevel(2.99, { size: 'large' })).toBe('fail')
  })
})

describe('evaluatePair', () => {
  it('returns ratio + level for a valid pair', () => {
    // Studio defaults: text (#111827) on background (#FFFFFF) → ~17.43 AAA
    const r = evaluatePair('#111827', '#FFFFFF')
    expect(r).not.toBeNull()
    expect(r!.level).toBe('AAA')
    expect(r!.ratio).toBeGreaterThan(15)
  })

  it('returns null when either color cant be parsed', () => {
    expect(evaluatePair('var(--primary)', '#FFFFFF')).toBeNull()
    expect(evaluatePair('#FFFFFF', null)).toBeNull()
    expect(evaluatePair(undefined, undefined)).toBeNull()
  })

  it('respects the size option for the bucket cutoff', () => {
    // Ratio that lands between AA-large and AA-normal thresholds.
    expect(evaluatePair('#767676', '#FFFFFF')!.level).toBe('AA') // ~4.54 normal
    expect(evaluatePair('#767676', '#FFFFFF', { size: 'large' })!.level).toBe('AAA') // exceeds 4.5
  })
})
