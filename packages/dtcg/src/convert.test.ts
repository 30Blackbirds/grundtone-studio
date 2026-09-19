import { describe, expect, it } from 'vitest'
import { cssColorToDtcg, cssFontFamilyToDtcg, cssLengthToDtcg } from './convert'

describe('cssColorToDtcg', () => {
  it('hex: srgb components plus a 6-digit hex, alpha only below 1 (E5)', () => {
    expect(cssColorToDtcg('#4F46E5')).toEqual({
      ok: true,
      value: {
        colorSpace: 'srgb',
        components: [0.309803921569, 0.274509803922, 0.898039215686],
        hex: '#4f46e5',
      },
    })
    expect(cssColorToDtcg('#fff')).toMatchObject({ ok: true, value: { hex: '#ffffff' } })
    expect(cssColorToDtcg('#00000080')).toMatchObject({
      ok: true,
      value: { hex: '#000000', alpha: 0.502 },
    })
    const opaque = cssColorToDtcg('#000f')
    expect(opaque.ok && 'alpha' in opaque.value).toBe(false)
  })

  it('rgb()/rgba() in comma and space syntax', () => {
    expect(cssColorToDtcg('rgb(255, 0, 0)')).toMatchObject({
      ok: true,
      value: { colorSpace: 'srgb', components: [1, 0, 0], hex: '#ff0000' },
    })
    expect(cssColorToDtcg('rgba(0 0 255 / 50%)')).toMatchObject({
      ok: true,
      value: { hex: '#0000ff', alpha: 0.5 },
    })
    expect(cssColorToDtcg('rgb(100%, 50%, 0%)')).toMatchObject({ value: { hex: '#ff8000' } })
  })

  it('hsl() keeps hsl, adds a hex fallback and wraps the hue into [0, 360)', () => {
    expect(cssColorToDtcg('hsl(120, 100%, 25%)')).toMatchObject({
      ok: true,
      value: { colorSpace: 'hsl', components: [120, 100, 25], hex: '#008000' },
    })
    expect(cssColorToDtcg('hsl(360deg 0% 0%)')).toMatchObject({
      ok: true,
      value: { components: [0, 0, 0] },
      note: { code: 'hue_normalised' },
    })
  })

  it('named colors resolve via the CSS table and are reported as converted', () => {
    expect(cssColorToDtcg('RebeccaPurple')).toMatchObject({
      ok: true,
      value: { hex: '#663399' },
      note: { code: 'named_color' },
    })
    expect(cssColorToDtcg('transparent')).toMatchObject({ ok: true, value: { alpha: 0 } })
  })

  // T3 canaries for the export side: each MUST be omitted, with its own code.
  it.each([
    ['rgb(foo)', 'color_channel'],
    ['rgb(300, 0, 0)', 'color_channel'],
    ['rgba(0, 0, 0, 2)', 'color_alpha'],
    ['notacolor', 'color_unsupported'],
    ['currentcolor', 'color_unsupported'],
    ['var(--brand)', 'color_var'],
  ])('omits %s (%s)', (input, code) => {
    expect(cssColorToDtcg(input)).toMatchObject({ ok: false, code })
  })
})

describe('cssLengthToDtcg', () => {
  it('px and rem pass through exactly', () => {
    expect(cssLengthToDtcg('0.25rem')).toEqual({ ok: true, value: { value: 0.25, unit: 'rem' } })
    expect(cssLengthToDtcg('12px')).toEqual({ ok: true, value: { value: 12, unit: 'px' } })
  })

  it('absolute units convert exactly to px and are reported (O5)', () => {
    expect(cssLengthToDtcg('1in')).toMatchObject({
      ok: true,
      value: { value: 96, unit: 'px' },
      note: { code: 'unit_converted' },
    })
    expect(cssLengthToDtcg('12pt')).toMatchObject({ value: { value: 16, unit: 'px' } })
    expect(cssLengthToDtcg('2.54cm')).toMatchObject({ value: { value: 96, unit: 'px' } })
    expect(cssLengthToDtcg('1pc')).toMatchObject({ value: { value: 16, unit: 'px' } })
  })

  it('unitless 0 becomes 0px', () => {
    expect(cssLengthToDtcg('0')).toMatchObject({
      ok: true,
      value: { value: 0, unit: 'px' },
      note: { code: 'unitless_zero' },
    })
  })

  it.each([
    ['1.5em', 'length_unit'],
    ['50%', 'length_unit'],
    ['10vh', 'length_unit'],
    ['4', 'length_unitless'],
    ['1.2.3px', 'length_not_number'],
  ])('omits %s (%s)', (input, code) => {
    expect(cssLengthToDtcg(input)).toMatchObject({ ok: false, code })
  })
})

describe('cssFontFamilyToDtcg', () => {
  it('splits a stack on top-level commas and drops quotes', () => {
    expect(cssFontFamilyToDtcg('\'Source Sans 3\', "Helvetica, Neue", sans-serif')).toEqual({
      ok: true,
      value: ['Source Sans 3', 'Helvetica, Neue', 'sans-serif'],
    })
  })

  it('a single family stays a string', () => {
    expect(cssFontFamilyToDtcg('Inter')).toEqual({ ok: true, value: 'Inter' })
  })

  it.each([
    [' , ', 'font_family_empty'],
    ["'Inter", 'font_family_quote'],
  ])('omits %j (%s)', (input, code) => {
    expect(cssFontFamilyToDtcg(input)).toMatchObject({ ok: false, code })
  })
})
