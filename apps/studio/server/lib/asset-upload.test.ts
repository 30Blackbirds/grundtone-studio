import { describe, expect, it } from 'vitest'
import {
  fontFileName,
  MAX_ASSET_BYTES,
  validateFontUpload,
  validateLogoUpload,
} from './asset-upload'

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const WOFF2_HEADER = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(16)])

describe('validateLogoUpload', () => {
  it('accepts PNG by magic bytes regardless of claimed name', () => {
    const res = validateLogoUpload(PNG_HEADER)
    expect(res).toMatchObject({ ok: true, type: 'png', contentType: 'image/png' })
  })

  it('accepts SVG and returns the SANITIZED body', () => {
    const res = validateLogoUpload(
      Buffer.from('<svg onload="alert(1)"><script>x()</script><rect/></svg>'),
    )
    expect(res.ok).toBe(true)
    if (res.ok && res.type === 'svg') {
      expect(res.body).not.toContain('script')
      expect(res.body).not.toContain('onload')
      expect(res.body).toContain('<rect/>')
    }
  })

  it('rejects oversize uploads at the 512KB cap', () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_ASSET_BYTES)])
    expect(validateLogoUpload(big)).toEqual({ ok: false, error: 'too_large' })
  })

  it('rejects non-svg/png content (magic bytes, not extension)', () => {
    expect(validateLogoUpload(Buffer.from('GIF89a...'))).toEqual({
      ok: false,
      error: 'unsupported_format',
    })
    expect(validateLogoUpload(Buffer.from('<!doctype html><html>x</html>'))).toEqual({
      ok: false,
      error: 'unsupported_format',
    })
  })
})

describe('validateFontUpload', () => {
  it('accepts woff2 by magic bytes', () => {
    expect(validateFontUpload(WOFF2_HEADER)).toMatchObject({ ok: true, contentType: 'font/woff2' })
  })

  it('rejects ttf/otf/renamed files', () => {
    expect(validateFontUpload(Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00]))).toEqual({
      ok: false,
      error: 'unsupported_format',
    })
  })

  it('rejects oversize fonts', () => {
    const big = Buffer.concat([WOFF2_HEADER, Buffer.alloc(MAX_ASSET_BYTES)])
    expect(validateFontUpload(big)).toEqual({ ok: false, error: 'too_large' })
  })
})

describe('fontFileName', () => {
  it('slugs family names into schema-valid references', () => {
    expect(fontFileName('Asp Grotesk', 400)).toBe('fonts/asp-grotesk-400.woff2')
    // æ/ø har ingen NFKD-dekomposition og droppes; å → a + ring → 'a'
    expect(fontFileName('Æøå Sans! 2.0', 700)).toBe('fonts/a-sans-2-0-700.woff2')
  })

  it('always matches the tokens-schema fontFile pattern', () => {
    const pattern = /^fonts\/[a-z0-9-]+\.woff2$/
    for (const name of ['---', '!!!', '日本語フォント', 'x'.repeat(200)]) {
      expect(fontFileName(name, 400)).toMatch(pattern)
    }
  })
})
