import { describe, it, expect } from 'vitest'
import { createTheme } from '@grundtone/core'

// Contract test for the createTheme call forms Studio itself uses, against the
// REAL @grundtone/core (riff qw9kcvy4x7whhmzcur84km4s).
//
// Measured 2026-09-15: core 2.22.0 accepts a full override object per mode
// ({ colors, typography, radius, spacing, transitions }); core 3.0.0 accepts
// colour presets only and silently resolves the other forms to defaults. The
// forms below are the ones in Studio's source, so a core bump that breaks any
// of them turns this file red instead of shipping the default brand.

describe('createTheme honours the override forms Studio passes', () => {
  // TokenPreview.vue: createTheme({ light: tokens }) with the published shape.
  it('{ light: tokens } — the published token shape', () => {
    const tokens = {
      colors: { primary: '#123456' },
      radius: { md: '9px' },
      spacing: { md: '13px' },
      typography: { fontFamily: { mono: "'Contract Mono', monospace" } },
    }
    const { light } = createTheme({ light: tokens as never })
    expect({
      primary: light.colors.primary,
      radius: light.radius.md,
      spacing: light.spacing.md,
      mono: light.typography.fontFamily.mono,
    }).toEqual({
      primary: '#123456',
      radius: '9px',
      spacing: '13px',
      mono: "'Contract Mono', monospace",
    })
  })

  // OnboardingTokensStep.vue: createTheme({ light: { colors: { primary } } }).
  it('{ light: { colors } } — a colours-only override object', () => {
    const { light } = createTheme({ light: { colors: { primary: '#654321' } } as never })
    expect(light.colors.primary).toBe('#654321')
    expect(Object.keys(light.colors)).not.toContain('colors')
  })

  // TokenEditor.vue: createTheme({ light: colours }) — a bare colour preset.
  // Valid on every core major; the positive control for the two cells above.
  it('{ light: colours } — a bare colour preset', () => {
    const { light, dark } = createTheme({
      light: { primary: '#0a0a0a' },
      dark: { primary: '#f5f5f5' },
    })
    expect([light.colors.primary, dark.colors.primary]).toEqual(['#0a0a0a', '#f5f5f5'])
  })
})
