import { describe, it, expect } from 'vitest'
import { COMPONENT_CATALOG, buildSnippet } from './component-catalog'

describe('COMPONENT_CATALOG integrity', () => {
  it('has unique names and valid groups', () => {
    const names = COMPONENT_CATALOG.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const c of COMPONENT_CATALOG) {
      expect(['Atoms', 'Molekyler']).toContain(c.group)
      expect(c.name).toMatch(/^GT[A-Z]/)
    }
  })

  it('every select control has options containing its default', () => {
    for (const c of COMPONENT_CATALOG) {
      for (const control of c.controls) {
        if (control.type === 'select') {
          expect(control.options?.length).toBeGreaterThan(0)
          expect(control.options).toContain(control.default)
        }
      }
    }
  })
})

describe('buildSnippet', () => {
  const button = COMPONENT_CATALOG.find((c) => c.name === 'GTButton')!

  it('omits defaults entirely', () => {
    const state = Object.fromEntries(button.controls.map((c) => [c.prop, c.default]))
    expect(buildSnippet(button, state)).toBe('<GTButton>Klik her</GTButton>')
  })

  it('renders non-default selects as attributes and true booleans as bare attrs', () => {
    const state = Object.fromEntries(button.controls.map((c) => [c.prop, c.default]))
    state.variant = 'negative'
    state.loading = true
    expect(buildSnippet(button, state)).toBe(
      '<GTButton variant="negative" loading>Klik her</GTButton>',
    )
  })

  it('self-closes slotless components and omits default text props', () => {
    const tag = COMPONENT_CATALOG.find((c) => c.name === 'GTTag')!
    const state = Object.fromEntries(tag.controls.map((c) => [c.prop, c.default]))
    state.dismissible = true
    expect(buildSnippet(tag, state)).toBe('<GTTag dismissible />')
  })

  it('kebab-cases camelCase props', () => {
    const input = COMPONENT_CATALOG.find((c) => c.name === 'GTInput')!
    const state = Object.fromEntries(input.controls.map((c) => [c.prop, c.default]))
    state.helpText = 'Hjælp'
    expect(buildSnippet(input, state)).toContain('help-text="Hjælp"')
  })

  it('adds v-model for model-bound components', () => {
    const input = COMPONENT_CATALOG.find((c) => c.name === 'GTInput')!
    const state = Object.fromEntries(input.controls.map((c) => [c.prop, c.default]))
    expect(buildSnippet(input, state)).toContain('v-model="value"')
  })

  it('uses overridden slot text', () => {
    const state = Object.fromEntries(button.controls.map((c) => [c.prop, c.default]))
    expect(buildSnippet(button, state, 'Gem')).toBe('<GTButton>Gem</GTButton>')
  })
})
