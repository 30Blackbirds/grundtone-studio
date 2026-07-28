import { describe, it, expect } from 'vitest'
import { tokensToCssVars } from './useThemeVars'

describe('tokensToCssVars', () => {
  it('maps colours to --color-* with camelCase → kebab-case', () => {
    const vars = tokensToCssVars({
      colors: { primary: '#0059b3', primaryLight: '#3381cc' },
    } as never)
    expect(vars['--color-primary']).toBe('#0059b3')
    expect(vars['--color-primary-light']).toBe('#3381cc')
  })

  it('maps spacing, radius and font families to their prefixes', () => {
    const vars = tokensToCssVars({
      spacing: { md: '1rem' },
      radius: { lg: '0.75rem' },
      typography: { fontFamily: { base: 'Inter' } },
    } as never)
    expect(vars['--space-md']).toBe('1rem')
    expect(vars['--radius-lg']).toBe('0.75rem')
    expect(vars['--font-family-base']).toBe('Inter')
  })

  it('skips empty values and handles null/undefined', () => {
    expect(tokensToCssVars(null)).toEqual({})
    expect(tokensToCssVars(undefined)).toEqual({})
    const vars = tokensToCssVars({ colors: { primary: '', secondary: '#fff' } } as never)
    expect(vars['--color-primary']).toBeUndefined()
    expect(vars['--color-secondary']).toBe('#fff')
  })
})
