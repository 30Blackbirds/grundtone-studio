import { describe, expect, it } from 'vitest'
import { resolveCdnBase } from './cdn-base'

const ORIGIN = 'http://localhost:3000'

describe('resolveCdnBase', () => {
  it('prefers the configured host', () => {
    expect(resolveCdnBase('https://cdn.grundtone.com', ORIGIN)).toBe('https://cdn.grundtone.com')
  })

  it.each([
    ['', 'empty'],
    [undefined, 'unset'],
    ['   ', 'whitespace'],
  ])('falls back to the request origin when the config is %j (%s)', (configured, _why) => {
    // 🔴 Whitespace, not only falsiness: `' '` is truthy, and the old
    // `config || literal` would have announced a host of one space.
    expect(resolveCdnBase(configured as string | undefined, ORIGIN)).toBe(ORIGIN)
  })

  it('strips a trailing slash from either source, so no URL gets a double slash', () => {
    expect(resolveCdnBase('https://cdn.grundtone.com/', ORIGIN)).toBe('https://cdn.grundtone.com')
    expect(resolveCdnBase('', 'http://localhost:3000/')).toBe(ORIGIN)
  })

  it('🔴 never returns a hardcoded production host of its own', () => {
    // The discriminating cell for KH-1178: the ONLY way this function can
    // produce cdn.grundtone.com is by being given it. A literal reintroduced
    // as a fallback would make this red.
    for (const configured of ['', undefined, '  ']) {
      expect(resolveCdnBase(configured as string | undefined, 'https://example.test')).toBe(
        'https://example.test',
      )
    }
  })
})
