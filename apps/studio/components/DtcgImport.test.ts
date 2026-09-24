// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import DtcgImport from './DtcgImport.vue'

// Cells for the import UI (KH-1044 I11). The mapping is pinned in
// packages/dtcg and the endpoint has its own cells; what is measured HERE is
// what the screen does with a report that came from a FOREIGN FILE.
//
// 🔴 The load-bearing one is `renders every string from the file as TEXT`. I11
// requires it because the paths, values and reasons in a report are written by
// whoever produced the document. A component can satisfy that today and lose it
// the moment someone reaches for v-html to "render the reason nicely", so the
// cell asserts on the rendered HTML rather than on the visible text.

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', (...args: unknown[]) => fetchMock(...args))
vi.stubGlobal('useI18n', () => ({
  // Keys are returned verbatim with their params appended, so a cell can assert
  // on a key without depending on Danish copy that translators may change.
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))
vi.stubGlobal('ref', ref)

const stub = (name: string, tag = 'div', props: string[] = []) =>
  defineComponent({
    name,
    props,
    emits: ['click', 'change'],
    setup(p, { slots, emit }) {
      return () =>
        h(
          tag,
          {
            'data-test': name,
            'data-heading': (p as Record<string, unknown>).heading,
            'data-summary': (p as Record<string, unknown>).summary,
            'data-label': (p as Record<string, unknown>).label,
            onClick: () => emit('click'),
          },
          slots.default?.(),
        )
    },
  })

const global = {
  components: {
    GTAlert: stub('GTAlert', 'div', ['variant', 'heading']),
    GTDetails: stub('GTDetails', 'details', ['summary', 'variant']),
    GTButton: stub('GTButton', 'button', ['variant', 'loading', 'disabled']),
    GTFileUpload: stub('GTFileUpload', 'div', ['label', 'helpText', 'accept']),
  },
}

const REPORT = {
  total: 4,
  mapped: [{ code: 'mapped', path: 'color.primary', value: '"#000000"', reason: 'mapped' }],
  converted: [
    { code: 'color_converted', path: 'color.brand', value: '"p3"', reason: 'display-p3 fallback' },
  ],
  notMapped: [{ code: 'unknown_path', path: 'elevation.card', value: '{}', reason: 'outside' }],
  invalid: [
    { code: 'dimension_negative', path: 'spacing.neg', value: '-4px', reason: 'no negatives' },
  ],
  notMappedByPrefix: { elevation: 1 },
  droppedExtensions: { 'com.example.tool': ['color.primary'] },
  parseErrors: [],
  overwritten: 2,
}

function mountAt(report: unknown = REPORT, canEdit = true) {
  const wrapper = mount(DtcgImport, {
    props: { projectId: 'p1', canEdit },
    global,
  })
  // Drive the component into its report phase the way a dry run does.
  ;(wrapper.vm as unknown as { base: unknown }).base = { name: 'tokens.json', json: {} }
  ;(wrapper.vm as unknown as { report: unknown }).report = report
  ;(wrapper.vm as unknown as { phase: string }).phase = 'report'
  return wrapper
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('the report screen', () => {
  it('shows the denominator: how many tokens the file held and where they went', async () => {
    const wrapper = mountAt()
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    expect(text).toContain('dtcgImport.summary')
    expect(text).toContain('"total":4')
    expect(text).toContain('"mapped":1')
    expect(text).toContain('"notMapped":1')
    expect(text).toContain('"invalid":1')
  })

  it('warns about values it would overwrite, before anything is written', async () => {
    const wrapper = mountAt()
    await wrapper.vm.$nextTick()
    const alert = wrapper.find('[data-test="GTAlert"]').attributes('data-heading')
    expect(alert).toContain('dtcgImport.overwrites')
    expect(alert).toContain('"n":2')
  })

  it('counts not-mapped tokens per top-level path, not their values (O1)', async () => {
    const wrapper = mountAt()
    await wrapper.vm.$nextTick()
    const html = wrapper.html()
    expect(html).toContain('elevation')
    // The VALUE of a not-mapped token is deliberately absent: the report says
    // how many, not what they were.
    expect(html).not.toContain('outside')
  })

  it('names the vendor extensions it dropped, so the loss is visible (I9)', async () => {
    const wrapper = mountAt()
    await wrapper.vm.$nextTick()
    expect(wrapper.html()).toContain('com.example.tool')
  })

  it('hides the save button without editor rights, and says why', async () => {
    const wrapper = mountAt(REPORT, false)
    await wrapper.vm.$nextTick()
    expect(wrapper.html()).toContain('dtcgImport.needsEditor')
    expect(wrapper.html()).not.toContain('dtcgImport.saveDraft')
  })
})

describe('🔴 strings from the file are TEXT, never markup (I11)', () => {
  const HOSTILE = {
    ...REPORT,
    invalid: [
      {
        code: 'dimension_negative',
        path: '<img src=x onerror="alert(1)">',
        value: '<script>alert(2)</script>',
        reason: '<b>bold</b> reason',
      },
    ],
    droppedExtensions: { '<svg onload="alert(3)">': ['<i>path</i>'] },
  }

  it('escapes a path, a value and a reason that carry markup', async () => {
    const wrapper = mountAt(HOSTILE)
    await wrapper.vm.$nextTick()
    const html = wrapper.html()

    // The strings ARE on screen — this is not a cell that passes by rendering
    // nothing.
    expect(wrapper.text()).toContain('onerror')
    expect(wrapper.text()).toContain('<b>bold</b> reason')

    // …and none of them became an element.
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(2)</script>')
    expect(html).not.toContain('<svg onload=')
    expect(html).toContain('&lt;')
  })

  it('has no v-html anywhere in the component source', async () => {
    // A rendering cell only sees the branches it drives, so this one reads the
    // source instead. It therefore says what it cannot see: it proves the two
    // strings are absent from THIS file — not that a child component, or a
    // helper this file imports, is free of them.
    const source: string = (await import('./DtcgImport.vue?raw')).default
    expect(source).toContain('<template>') // the raw source, not the compiled SFC
    // The DIRECTIVE, not the word: the file's own comment says "never v-html",
    // and a cell that cannot tell the warning from the hazard is worthless.
    expect(source).not.toMatch(/v-html\s*=/)
    expect(source).not.toMatch(/\.innerHTML/)
  })
})
