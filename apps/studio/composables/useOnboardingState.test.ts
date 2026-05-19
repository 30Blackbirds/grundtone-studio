import { describe, it, expect } from 'vitest'
import { slugify } from './useOnboardingState'

describe('slugify', () => {
  it('lowercases and kebab-cases', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp')
    expect(slugify('My Big Project')).toBe('my-big-project')
  })

  it('strips Nordic diacritics so users get a clean slug', () => {
    expect(slugify('Café Étranger')).toBe('cafe-etranger')
    expect(slugify('Grøn å')).toBe('gron-a')
    expect(slugify('Ærø')).toBe('aero')
  })

  it('collapses repeats and trims edges', () => {
    expect(slugify('   --- Big   Name ---   ')).toBe('big-name')
    expect(slugify('!!!hello!!!')).toBe('hello')
  })

  it('caps length at 64 chars to match the DB constraint', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long).length).toBeLessThanOrEqual(64)
  })

  it('returns empty string for input that yields no chars', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('')).toBe('')
  })
})
