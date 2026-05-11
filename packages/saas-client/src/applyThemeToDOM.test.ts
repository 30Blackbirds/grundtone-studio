import { describe, it, expect, beforeEach } from 'vitest'
import { applyThemeToDOM } from './applyThemeToDOM'

function makeTheme(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'light' as const,
    colors: { primary: '#000', onPrimary: '#fff' },
    spacing: { md: '1rem' },
    typography: {
      fontFamily: { base: 'Inter' },
      fontSize: { md: '1rem' },
      fontWeight: { normal: 400 },
      lineHeight: { normal: 1.5 },
    },
    radius: { md: '0.5rem' },
    shadowDefinitions: {},
    zIndex: { modal: 100 },
    transitions: { duration: { base: '200ms' }, timing: { ease: 'ease-out' } },
    ...overrides,
  } as Parameters<typeof applyThemeToDOM>[0]
}

describe('applyThemeToDOM', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('writes color custom properties as kebab-case', () => {
    applyThemeToDOM(makeTheme({ colors: { primary: '#abc', onPrimary: '#fff' } }))
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#abc')
    expect(document.documentElement.style.getPropertyValue('--color-on-primary')).toBe('#fff')
  })

  it('respects the target element if passed', () => {
    const el = document.createElement('div')
    applyThemeToDOM(makeTheme(), el)
    expect(el.style.getPropertyValue('--color-primary')).toBe('#000')
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('')
  })

  it('emits radius and spacing variables', () => {
    applyThemeToDOM(makeTheme({ radius: { md: '0.5rem' }, spacing: { md: '1rem' } }))
    expect(document.documentElement.style.getPropertyValue('--radius-md')).toBe('0.5rem')
    expect(document.documentElement.style.getPropertyValue('--space-md')).toBe('1rem')
  })

  it('sets color-scheme based on mode', () => {
    applyThemeToDOM(makeTheme({ mode: 'dark' }))
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark')
  })
})
