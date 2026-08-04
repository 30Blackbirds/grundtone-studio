import { describe, expect, it } from 'vitest'
import { looksLikeSvg, sanitizeSvg } from './svg-sanitize'

describe('sanitizeSvg', () => {
  it('strips script blocks', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>')
    expect(out).not.toContain('script')
    expect(out).toContain('<rect/>')
  })

  it('survives the nested-script bypass (fixpoint iteration)', () => {
    const out = sanitizeSvg('<svg><scr<script>alert(1)</script>ipt>alert(2)</script></svg>')
    expect(out).not.toContain('alert')
  })

  it('strips unterminated script blocks', () => {
    const out = sanitizeSvg('<svg><rect/><script>alert(1)')
    expect(out).not.toContain('alert')
  })

  it('strips foreignObject (HTML smuggling vector)', () => {
    const out = sanitizeSvg('<svg><foreignObject><iframe src="x"/></foreignObject><circle/></svg>')
    expect(out).not.toContain('foreignObject')
    expect(out).not.toContain('iframe')
    expect(out).toContain('<circle/>')
  })

  it('strips event handlers in both quote styles and unquoted', () => {
    const out = sanitizeSvg(
      `<svg onload="alert(1)"><rect onclick='alert(2)'/><g onmouseover=alert(3)></g></svg>`,
    )
    expect(out).not.toContain('alert')
    expect(out).not.toMatch(/\son[a-z]+/)
  })

  it('strips javascript: hrefs incl. xlink', () => {
    const out = sanitizeSvg(
      `<svg><a href="javascript:alert(1)">x</a><use xlink:href='javascript:alert(2)'/></svg>`,
    )
    expect(out).not.toContain('javascript:')
  })

  it('strips external http(s) references but keeps inline content', () => {
    const out = sanitizeSvg(
      `<svg><image href="https://evil.example/x.png"/><rect fill="url(#grad)"/></svg>`,
    )
    expect(out).not.toContain('evil.example')
    expect(out).toContain('url(#grad)')
  })

  it('leaves a clean logo untouched', () => {
    const clean = '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#0059b3"/></svg>'
    expect(sanitizeSvg(clean)).toBe(clean)
  })
})

describe('looksLikeSvg', () => {
  it('accepts plain, xml-prologed, doctyped and commented svg', () => {
    expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true)
    expect(looksLikeSvg('<?xml version="1.0"?><svg></svg>')).toBe(true)
    expect(looksLikeSvg('<?xml version="1.0"?>\n<!DOCTYPE svg><!-- x --><svg/>')).toBe(true)
  })

  it('rejects html and arbitrary content', () => {
    expect(looksLikeSvg('<!doctype html><html><body>x</body></html>')).toBe(false)
    expect(looksLikeSvg('PNG\x89 not svg')).toBe(false)
    expect(looksLikeSvg('')).toBe(false)
  })
})
