import { describe, it, expect } from 'vitest'
import { diffTokens, isColorPath } from './token-diff'

describe('diffTokens', () => {
  it('reports added, changed and removed paths with values', () => {
    const changes = diffTokens(
      { colors: { primary: '#0059b3', surface: '#f5f5f5' }, spacing: { md: '1rem' } },
      { colors: { primary: '#004a94', text: '#111' }, spacing: { md: '1rem' } },
    )
    expect(changes).toEqual([
      { path: 'colors.primary', kind: 'changed', from: '#0059b3', to: '#004a94' },
      { path: 'colors.surface', kind: 'removed', from: '#f5f5f5' },
      { path: 'colors.text', kind: 'added', to: '#111' },
    ])
  })

  it('diffs nested dark overrides as dotted paths', () => {
    const changes = diffTokens({}, { dark: { colors: { background: '#111318' } } })
    expect(changes).toEqual([{ path: 'dark.colors.background', kind: 'added', to: '#111318' }])
  })

  it('returns empty for identical trees and handles a first version (empty from)', () => {
    const tokens = { colors: { primary: '#0059b3' } }
    expect(diffTokens(tokens, tokens)).toEqual([])
    expect(diffTokens({}, tokens)).toEqual([
      { path: 'colors.primary', kind: 'added', to: '#0059b3' },
    ])
  })

  it('sorts changes by path for stable rendering', () => {
    const changes = diffTokens({}, { spacing: { md: '1rem' }, colors: { primary: '#111' } })
    expect(changes.map((c) => c.path)).toEqual(['colors.primary', 'spacing.md'])
  })
})

describe('isColorPath', () => {
  it('matches base and dark color paths only', () => {
    expect(isColorPath('colors.primary')).toBe(true)
    expect(isColorPath('dark.colors.background')).toBe(true)
    expect(isColorPath('spacing.md')).toBe(false)
    expect(isColorPath('typography.fontFamily.base')).toBe(false)
  })
})
