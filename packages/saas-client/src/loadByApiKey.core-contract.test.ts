import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadByApiKey } from './index'

// Contract test against the REAL @grundtone/core (riff qw9kcvy4x7whhmzcur84km4s).
//
// loadByApiKey.test.ts mocks createTheme to test the SDK's wiring, so it cannot
// see what core does with published tokens. Measured 2026-09-15: core 2.22.0
// applies colours, radius, spacing and typography from `{ light: tokens }`;
// core 3.0.0 accepts only colour presets there and silently resolves every
// value in this fixture to the defaults. A bump of `@grundtone/core` to ^3
// would ship an SDK that applies no tenant brand while every mocked test stays
// green. This file is what turns that bump red.

const TOKENS = {
  colors: { primary: '#123456', background: '#fafafa' },
  radius: { md: '9px' },
  spacing: { md: '13px' },
  typography: { fontFamily: { mono: "'Contract Mono', monospace" } },
  dark: { colors: { primary: '#abcdef' } },
}

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name)

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(TOKENS), { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadByApiKey with the real @grundtone/core applies the published tokens', () => {
  it('light mode: colours, radius, spacing and font family come from the tenant', async () => {
    await loadByApiKey({ apiKey: 'pk_contract', mode: 'light' })
    expect({
      primary: cssVar('--color-primary'),
      background: cssVar('--color-background'),
      radius: cssVar('--radius-md'),
      spacing: cssVar('--space-md'),
      mono: cssVar('--font-family-mono'),
    }).toEqual({
      primary: '#123456',
      background: '#fafafa',
      radius: '9px',
      spacing: '13px',
      mono: "'Contract Mono', monospace",
    })
  })

  it('dark mode: the dark colour layer is applied over the tenant tokens', async () => {
    await loadByApiKey({ apiKey: 'pk_contract', mode: 'dark' })
    expect({ primary: cssVar('--color-primary'), radius: cssVar('--radius-md') }).toEqual({
      primary: '#abcdef',
      radius: '9px',
    })
  })

  it('never writes a token group as a colour ("[object Object]")', async () => {
    await loadByApiKey({ apiKey: 'pk_contract', mode: 'light' })
    for (const group of ['colors', 'radius', 'spacing', 'typography']) {
      expect(cssVar(`--color-${group}`)).toBe('')
    }
  })
})
