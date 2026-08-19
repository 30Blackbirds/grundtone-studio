// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import TokenEditor from './TokenEditor.vue'

// Params-aware $t — TokenEditor's labels don't take params today, but tests
// shouldn't break if a future label adds one. Safe to define after the SFC
// import — <script setup> doesn't evaluate until mount() runs.
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${JSON.stringify(params)})` : key,
}))

// Stub each TokenColorField so tests can emit `update:model-value` from a
// known data-attribute selector. The real component proxies to GTInput +
// color picker; we don't want to drag that machinery into a model-flow test.
const TokenColorField = defineComponent({
  name: 'TokenColorField',
  props: ['label', 'modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  setup(props) {
    return () =>
      h('div', {
        'data-test': 'color-field',
        'data-label': props.label,
        'data-value': props.modelValue ?? '',
        'data-placeholder': props.placeholder ?? '',
      })
  },
})

const ContrastBadge = defineComponent({
  name: 'ContrastBadge',
  props: ['label', 'fg', 'bg'],
  setup(props) {
    return () =>
      h('div', {
        'data-test': 'contrast-badge',
        'data-label': props.label,
        'data-fg': props.fg ?? '',
        'data-bg': props.bg ?? '',
      })
  },
})

const GTInput = defineComponent({
  name: 'GTInput',
  props: ['modelValue', 'label', 'placeholder'],
  emits: ['update:modelValue'],
  setup(props) {
    return () =>
      h('div', {
        'data-test': 'gt-input',
        'data-label': props.label,
        'data-placeholder': props.placeholder ?? '',
        'data-value': props.modelValue ?? '',
      })
  },
})

const GTAccordion = defineComponent({
  name: 'GTAccordion',
  setup(_, { slots }) {
    return () => h('div', { 'data-test': 'accordion' }, slots.default?.())
  },
})
const GTAccordionItem = defineComponent({
  name: 'GTAccordionItem',
  props: ['heading', 'summary', 'open', 'headingLevel'],
  setup(props, { slots }) {
    return () =>
      h(
        'section',
        {
          'data-test': 'accordion-item',
          'data-heading': props.heading,
          'data-open': String(!!props.open),
          'data-summary': props.summary ?? '',
        },
        slots.default?.(),
      )
  },
})
const GTButton = defineComponent({
  name: 'GTButton',
  props: ['variant', 'size', 'ariaExpanded', 'ariaPressed'],
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () =>
      h('button', { 'data-test': 'gt-button', onClick: () => emit('click') }, slots.default?.())
  },
})

const global = {
  components: { TokenColorField, ContrastBadge, GTInput, GTAccordion, GTAccordionItem, GTButton },
  mocks: {
    $t: (k: string) => k,
  },
}

function baseTokens() {
  // Matches the shape that the server side ships from DEFAULT_TOKENS. Tests
  // don't need every key — just enough for the editor to render and for
  // assertions to verify which fields survived a mutation.
  return {
    colors: {
      primary: '#4F46E5',
      primaryLight: '#818CF8',
      primaryDark: '#3730A3',
      onPrimary: '#FFFFFF',
      secondary: '#0EA5E9',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6',
      background: '#FFFFFF',
      surface: '#F9FAFB',
      text: '#111827',
      textSecondary: '#4B5563',
      textTertiary: '#9CA3AF',
    },
    typography: { fontFamily: { base: 'Inter', heading: 'Inter' } },
    radius: { sm: '0.25rem', md: '0.5rem', lg: '0.75rem', xl: '1rem' },
    spacing: { sm: '0.5rem', md: '1rem', lg: '1.5rem' },
  }
}

describe('TokenEditor', () => {
  it('renders the 9 base colour fields by default; derived fields sit behind a per-group toggle', async () => {
    const w = mount(TokenEditor, { props: { modelValue: baseTokens() }, global })
    // [designer]-forlæg token-editor-grouping.md: 9 base-beslutninger synlige,
    // resten "afledte" bag "Vis afledte" PR. GRUPPE — 39 felter må aldrig
    // vises som 39 felter. Antallet er bundet til COLOR_SLOT_GROUPS (egen test).
    expect(w.findAll('[data-test="color-field"]')).toHaveLength(9)
    expect(w.findAll('[data-test="accordion-item"]')).toHaveLength(7)
    const openGroups = w
      .findAll('[data-test="accordion-item"]')
      .filter((i) => i.attributes('data-open') === 'true')
      .map((i) => i.attributes('data-heading'))
    expect(openGroups).toEqual(['tokens.group.brand', 'tokens.group.surfaces'])

    // Åbn "Vis afledte" i Brand-gruppen → 5 afledte felter mere (ikke alle 30)
    const brand = w.findAll('[data-test="accordion-item"]')[0]!
    await brand.find('[data-test="gt-button"]').trigger('click')
    expect(w.findAll('[data-test="color-field"]')).toHaveLength(9 + 5)
  })

  it('shows the resolved value as placeholder for an un-overridden derived slot, the set value for an overridden one', async () => {
    const w = mount(TokenEditor, { props: { modelValue: baseTokens() }, global })
    const brand = w.findAll('[data-test="accordion-item"]')[0]!
    await brand.find('[data-test="gt-button"]').trigger('click')
    const fields = w.findAll('[data-test="color-field"]')
    // primaryLight ER sat i baseTokens → tilpasset: value, ikke placeholder
    const pl = fields.find((f) => f.attributes('data-label') === 'tokens.color.primaryLight')!
    expect(pl.attributes('data-value')).toBe('#818CF8')
    // secondaryLight er IKKE sat → auto: tom value, resolved stock som placeholder
    const sl = fields.find((f) => f.attributes('data-label') === 'tokens.color.secondaryLight')!
    expect(sl.attributes('data-value')).toBe('')
    expect(sl.attributes('data-placeholder')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('renders the contrast pairs (4 in the section + 4 inline at base fields) against the right fg/bg', async () => {
    const w = mount(TokenEditor, { props: { modelValue: baseTokens() }, global })
    const badges = w.findAll('[data-test="contrast-badge"]')
    expect(badges).toHaveLength(4 + 4)
    // text-on-background: dark text against white. Spot-checking one pair is
    // enough to confirm the binding direction; the rest follow the same
    // template pattern.
    const textOnBg = badges.find((b) => b.attributes('data-label')?.includes('textOnBackground'))
    expect(textOnBg?.attributes('data-fg')).toBe('#111827')
    expect(textOnBg?.attributes('data-bg')).toBe('#FFFFFF')
  })

  it('emits a merged tokens object when a color field updates', async () => {
    const w = mount(TokenEditor, { props: { modelValue: baseTokens() }, global })
    const primary = w
      .findAllComponents(TokenColorField)
      .find((c) => c.props('label') === 'tokens.color.primary')
    expect(primary).toBeDefined()
    await primary!.vm.$emit('update:modelValue', '#00FF00')

    const emits = w.emitted('update:modelValue')
    expect(emits).toBeTruthy()
    const next = emits![emits!.length - 1][0] as ReturnType<typeof baseTokens>
    // Only the changed slot mutates; every other slot is preserved verbatim.
    expect(next.colors.primary).toBe('#00FF00')
    expect(next.colors.primaryLight).toBe('#818CF8')
    expect(next.spacing).toEqual(baseTokens().spacing)
    expect(next.radius).toEqual(baseTokens().radius)
    expect(next.typography).toEqual(baseTokens().typography)
  })

  it('emits a merged tokens object when a radius input updates', async () => {
    const w = mount(TokenEditor, { props: { modelValue: baseTokens() }, global })
    const mdRadius = w
      .findAllComponents(GTInput)
      .find((c) => c.props('label') === 'md' && c.props('placeholder') === '0.5rem')
    expect(mdRadius).toBeDefined()
    await mdRadius!.vm.$emit('update:modelValue', '0.75rem')

    const next = (w.emitted('update:modelValue') as unknown[][])[0][0] as ReturnType<
      typeof baseTokens
    >
    expect(next.radius.md).toBe('0.75rem')
    expect(next.radius.sm).toBe('0.25rem')
    expect(next.colors).toEqual(baseTokens().colors)
  })

  it('emits a merged tokens object when a spacing input updates', async () => {
    const w = mount(TokenEditor, { props: { modelValue: baseTokens() }, global })
    // Spacing-md placeholder is "1rem", distinguishing it from radius-md.
    const mdSpacing = w
      .findAllComponents(GTInput)
      .find((c) => c.props('label') === 'md' && c.props('placeholder') === '1rem')
    expect(mdSpacing).toBeDefined()
    await mdSpacing!.vm.$emit('update:modelValue', '1.25rem')

    const next = (w.emitted('update:modelValue') as unknown[][])[0][0] as ReturnType<
      typeof baseTokens
    >
    expect(next.spacing.md).toBe('1.25rem')
    expect(next.spacing.sm).toBe('0.5rem')
  })

  it('emits a merged tokens object when a font-family input updates', async () => {
    const w = mount(TokenEditor, { props: { modelValue: baseTokens() }, global })
    const base = w.findAllComponents(GTInput).find((c) => c.props('label') === 'tokens.font.base')
    expect(base).toBeDefined()
    await base!.vm.$emit('update:modelValue', 'IBM Plex Sans')

    const next = (w.emitted('update:modelValue') as unknown[][])[0][0] as ReturnType<
      typeof baseTokens
    >
    expect(next.typography.fontFamily.base).toBe('IBM Plex Sans')
    expect(next.typography.fontFamily.heading).toBe('Inter')
  })

  it('passes empty values through to color fields when colors slot is missing', async () => {
    const w = mount(TokenEditor, {
      props: { modelValue: { typography: { fontFamily: {} } } },
      global,
    })
    // The colors slot is undefined in the model. computed.get() falls back to
    // `{}`, so every color field renders with an empty model-value rather than
    // throwing on `.primary` access.
    const colorFields = w.findAll('[data-test="color-field"]')
    expect(colorFields).toHaveLength(9)
    for (const f of colorFields) {
      expect(f.attributes('data-value')).toBe('')
    }
  })

  // [designer]-spec 2026-08-19: signalér når en slot i DARK arver tenantens
  // egen LYSE værdi (usat i dark + sat i light). Usat begge steder = to
  // konsistente stock-defaults, ikke en fælde — intet signal.
  describe('inherits-light signal (dark mode)', () => {
    function mountDark(model: Record<string, unknown>) {
      return mount(TokenEditor, {
        props: { modelValue: model, mode: 'dark' },
        global,
      })
    }

    it('flags a slot set in light but unset in dark', () => {
      const w = mountDark({
        colors: { primary: '#d63a54', background: '#ffffff' },
        dark: { colors: { primary: '#ef6479' } },
      })
      const flags = w.findAll('.inherits-light')
      // background: sat i light, usat i dark → flagget.
      // primary: overstyret i dark → ikke flagget.
      expect(flags).toHaveLength(1)
      expect(flags[0]!.attributes('title')).toContain('#ffffff')
    })

    it('does not flag a slot unset in BOTH modes (two consistent stock defaults)', () => {
      const w = mountDark({
        colors: { primary: '#d63a54' },
        dark: { colors: { primary: '#ef6479' } },
      })
      expect(w.findAll('.inherits-light')).toHaveLength(0)
    })

    it('does not flag anything in light mode', () => {
      const w = mount(TokenEditor, {
        props: {
          modelValue: {
            colors: { background: '#ffffff' },
            dark: { colors: { primary: '#ef6479' } },
          },
        },
        global,
      })
      expect(w.findAll('.inherits-light')).toHaveLength(0)
    })

    it('does NOT flag groups outside the four visual ones (focus/status/neutral)', () => {
      // [designer]-spec: i Fokus/Status/Neutral er "samme i begge tilstande"
      // som regel tilsigtet — et signal dér ville overdøve de rigtige.
      // focus er sat i light, usat i dark → ville flage hvis gruppe-flaget
      // blev ignoreret. Mutations-testet: uden warnInheritsLight-betingelsen
      // bliver denne rød.
      const w = mountDark({
        colors: { focus: '#d63a54', success: '#198754' },
        dark: { colors: { primary: '#ef6479' } },
      })
      // Åbn de afledte i Fokus-gruppen, så feltet faktisk er i DOM'en
      const focusGroup = w
        .findAll('[data-test="accordion-item"]')
        .find((i) => i.attributes('data-heading') === 'tokens.group.focus')!
      return focusGroup
        .find('[data-test="gt-button"]')
        .trigger('click')
        .then(() => {
          expect(w.findAll('.inherits-light')).toHaveLength(0)
          expect(focusGroup.attributes('data-summary')).toBe('')
        })
    })

    it('counts inheriting slots in the group summary', () => {
      const w = mountDark({
        colors: { background: '#ffffff', surface: '#f7f5f0' },
        dark: { colors: { primary: '#ef6479' } },
      })
      const surfaces = w
        .findAll('[data-test="accordion-item"]')
        .find((i) => i.attributes('data-heading') === 'tokens.group.surfaces')!
      expect(surfaces.attributes('data-summary')).toContain('tokens.editor.inheritsLightCount')
    })
  })
})
