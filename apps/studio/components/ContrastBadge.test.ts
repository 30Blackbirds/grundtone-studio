// @vitest-environment happy-dom

// Pattern for Vue component tests in the studio app. Test files for
// non-trivial components (TokenEditor, ApiKeyManager, VersionHistory)
// follow this same setup — vi.mock the grundtone-vue surface so we don't
// need a real component library boot, then mount the SFC and assert
// against rendered output.

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import ContrastBadge from './ContrastBadge.vue'

// Stub the grundtone-vue components the SFC imports as auto-globals.
// Each stub renders a recognisable element so we can query for it
// without pulling in the real implementation.
vi.mock('@grundtone/vue', () => ({
  GTBadge: defineComponent({
    name: 'GTBadge',
    props: ['variant'],
    setup(props, { slots }) {
      return () =>
        h('span', { 'data-test': 'gt-badge', 'data-variant': props.variant }, slots.default?.())
    },
  }),
}))

// useI18n autoimport — return the key verbatim so assertions are stable.
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }))

// The SFC also auto-resolves <GTBadge> via Nuxt's component resolution.
// vue-test-utils doesn't run that resolver, so we provide it as a global
// component alias on mount. The same applies to any other GT* auto-import.
const global = {
  components: {
    GTBadge: defineComponent({
      name: 'GTBadge',
      props: ['variant'],
      setup(props, { slots }) {
        return () =>
          h('span', { 'data-test': 'gt-badge', 'data-variant': props.variant }, slots.default?.())
      },
    }),
  },
  // `$t` is the template-only i18n helper Nuxt installs as a Vue global.
  // The composition-API useI18n() stub from tests/setup-vue.ts handles
  // <script setup>; this covers the template path. Returns the key
  // verbatim so assertions stay stable.
  mocks: { $t: (k: string) => k },
}

describe('ContrastBadge', () => {
  it('renders the AAA variant for a high-contrast pair (black on white)', () => {
    const w = mount(ContrastBadge, {
      props: { fg: '#000000', bg: '#FFFFFF', label: 'Text on background' },
      global,
    })
    const badge = w.find('[data-test="gt-badge"]')
    expect(badge.attributes('data-variant')).toBe('success')
    expect(badge.text()).toBe('contrast.level.AAA')
  })

  it('renders the AA variant for a mid-contrast pair', () => {
    // #767676 on #FFFFFF lands around 4.54:1 — passes AA, fails AAA.
    const w = mount(ContrastBadge, {
      props: { fg: '#767676', bg: '#FFFFFF', label: 'mid' },
      global,
    })
    expect(w.find('[data-test="gt-badge"]').attributes('data-variant')).toBe('info')
  })

  it('renders the fail variant when contrast is below 3:1', () => {
    // #DDDDDD on #FFFFFF — way too low.
    const w = mount(ContrastBadge, {
      props: { fg: '#DDDDDD', bg: '#FFFFFF', label: 'low' },
      global,
    })
    expect(w.find('[data-test="gt-badge"]').attributes('data-variant')).toBe('error')
  })

  it("renders the neutral variant + unparseable hint when colours can't be read", () => {
    const w = mount(ContrastBadge, {
      props: { fg: 'rgb(0,0,0)', bg: 'var(--primary)', label: 'unparseable' },
      global,
    })
    const badge = w.find('[data-test="gt-badge"]')
    expect(badge.attributes('data-variant')).toBe('neutral')
    expect(badge.text()).toBe('—')
    expect(w.text()).toContain('contrast.unparseable')
  })

  it('formats the contrast ratio to two decimals', () => {
    const w = mount(ContrastBadge, {
      props: { fg: '#000000', bg: '#FFFFFF', label: 'ratio' },
      global,
    })
    // Max contrast is 21:1; the rendered text rounds to "21.00 : 1".
    expect(w.text()).toContain('21.00 : 1')
  })

  it('renders the label prop verbatim', () => {
    const w = mount(ContrastBadge, {
      props: { fg: '#000', bg: '#fff', label: 'Custom label here' },
      global,
    })
    expect(w.text()).toContain('Custom label here')
  })

  it('marks the swatch as aria-hidden (decorative only)', () => {
    const w = mount(ContrastBadge, {
      props: { fg: '#000', bg: '#fff', label: 'a11y' },
      global,
    })
    const swatch = w.find('.contrast-swatch')
    expect(swatch.attributes('aria-hidden')).toBe('true')
  })

  it('respects size="large" thresholds (lower bars)', () => {
    // #767676 on #FFFFFF is 4.54:1 — AA at normal, AAA at large.
    const w = mount(ContrastBadge, {
      props: { fg: '#767676', bg: '#FFFFFF', label: 'large', size: 'large' },
      global,
    })
    expect(w.find('[data-test="gt-badge"]').attributes('data-variant')).toBe('success')
  })
})
