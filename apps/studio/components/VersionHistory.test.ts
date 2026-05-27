// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import VersionHistory from './VersionHistory.vue'

// Stub Nuxt auto-imports the SFC reaches for. useAsyncData mirrors Nuxt's
// shape: calls the fetcher once at setup time, exposes a reactive `data`
// ref and a refresh() that re-runs the fetcher. Safe to define after the SFC
// import — <script setup> doesn't evaluate until mount() runs.
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', (...args: unknown[]) => fetchMock(...args))
vi.stubGlobal(
  'useAsyncData',
  async (_key: unknown, fn: () => unknown, opts?: { default?: () => unknown }) => {
    let value
    try {
      value = await fn()
    } catch {
      value = opts?.default ? opts.default() : null
    }
    const data = ref(value)
    const refresh = async () => {
      data.value = await fn()
    }
    return { data, refresh }
  },
)
vi.stubGlobal('useRequestHeaders', () => ({}))

const confirmMock = vi.fn(() => true)
vi.stubGlobal('confirm', confirmMock)

const GTBadge = defineComponent({
  name: 'GTBadge',
  props: ['variant'],
  setup(props, { slots }) {
    return () =>
      h('span', { 'data-test': 'gt-badge', 'data-variant': props.variant }, slots.default?.())
  },
})

const GTButton = defineComponent({
  name: 'GTButton',
  props: ['variant', 'size', 'loading'],
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () =>
      h(
        'button',
        {
          'data-test': 'gt-button',
          'data-loading': props.loading ? 'true' : 'false',
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const global = {
  components: { GTBadge, GTButton },
  mocks: {
    $t: (k: string, params?: Record<string, unknown>) =>
      params ? `${k}(${JSON.stringify(params)})` : k,
  },
}

const PROJECT_ID = 'project-1'

function v(id: string, version: number, status: 'draft' | 'published'): unknown {
  return {
    id,
    version,
    status,
    publishedAt: status === 'published' ? '2026-05-20T12:00:00Z' : null,
    createdAt: '2026-05-19T08:00:00Z',
  }
}

// VersionHistory has top-level await in <script setup>, which makes Vue
// treat it as an async component. mount() doesn't wrap children in
// <Suspense> automatically, so we provide it here.
const Wrapper = defineComponent({
  components: { VersionHistory },
  props: {
    projectId: { type: String, required: true },
    canManage: { type: Boolean, default: false },
  },
  emits: ['activated'],
  template: `
    <Suspense>
      <VersionHistory
        :project-id="projectId"
        :can-manage="canManage"
        @activated="$emit('activated')"
      />
    </Suspense>`,
})

beforeEach(() => {
  fetchMock.mockReset()
  confirmMock.mockReset()
  confirmMock.mockReturnValue(true)
})

describe('VersionHistory', () => {
  it('renders an empty state when no versions exist', async () => {
    fetchMock.mockResolvedValueOnce({ versions: [], activeVersionId: null })
    const w = mount(Wrapper, {
      props: { projectId: PROJECT_ID, canManage: true },
      global,
    })
    await flushPromises()
    expect(w.text()).toContain('versions.empty')
  })

  it('shows the draft section when a draft exists', async () => {
    fetchMock.mockResolvedValueOnce({
      versions: [v('d1', 0, 'draft')],
      activeVersionId: null,
    })
    const w = mount(Wrapper, {
      props: { projectId: PROJECT_ID, canManage: true },
      global,
    })
    await flushPromises()
    expect(w.text()).toContain('versions.draftLabel')
  })

  it('renders one row per published version with v{n} label', async () => {
    fetchMock.mockResolvedValueOnce({
      versions: [v('p1', 1, 'published'), v('p2', 2, 'published'), v('p3', 3, 'published')],
      activeVersionId: 'p2',
    })
    const w = mount(Wrapper, {
      props: { projectId: PROJECT_ID, canManage: true },
      global,
    })
    await flushPromises()
    expect(w.text()).toContain('v1')
    expect(w.text()).toContain('v2')
    expect(w.text()).toContain('v3')
  })

  it('marks the active version with a success badge and no activate button', async () => {
    fetchMock.mockResolvedValueOnce({
      versions: [v('p1', 1, 'published'), v('p2', 2, 'published')],
      activeVersionId: 'p2',
    })
    const w = mount(Wrapper, {
      props: { projectId: PROJECT_ID, canManage: true },
      global,
    })
    await flushPromises()
    const badges = w.findAll('[data-test="gt-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0].attributes('data-variant')).toBe('success')
    // One activate button only — for p1, the non-active row.
    expect(w.findAll('[data-test="gt-button"]')).toHaveLength(1)
  })

  it('hides activate buttons when canManage is false', async () => {
    fetchMock.mockResolvedValueOnce({
      versions: [v('p1', 1, 'published'), v('p2', 2, 'published')],
      activeVersionId: 'p2',
    })
    const w = mount(Wrapper, {
      props: { projectId: PROJECT_ID, canManage: false },
      global,
    })
    await flushPromises()
    // Active badge still renders, but no buttons.
    expect(w.findAll('[data-test="gt-badge"]')).toHaveLength(1)
    expect(w.findAll('[data-test="gt-button"]')).toHaveLength(0)
  })

  it('activate(): confirms, POSTs to /activate, refreshes, and emits "activated"', async () => {
    fetchMock
      .mockResolvedValueOnce({
        // initial fetch
        versions: [v('p1', 1, 'published'), v('p2', 2, 'published')],
        activeVersionId: 'p1',
      })
      .mockResolvedValueOnce({ version: 2, activatedAt: new Date() }) // POST /activate
      .mockResolvedValueOnce({
        // refresh after activate
        versions: [v('p1', 1, 'published'), v('p2', 2, 'published')],
        activeVersionId: 'p2',
      })

    const w = mount(Wrapper, {
      props: { projectId: PROJECT_ID, canManage: true },
      global,
    })
    await flushPromises()

    const activateButton = w.find('[data-test="gt-button"]')
    await activateButton.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    // The POST goes to the activate endpoint with the version id.
    const postCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/activate'),
    )
    expect(postCall).toBeDefined()
    expect(postCall![0]).toBe(`/api/projects/${PROJECT_ID}/activate`)
    expect((postCall![1] as { body?: { versionId: string } }).body?.versionId).toBe('p2')
    // `activated` event fired exactly once.
    expect(w.emitted('activated')).toHaveLength(1)
  })

  it('activate(): aborts when the confirm prompt is rejected', async () => {
    confirmMock.mockReturnValue(false)
    fetchMock.mockResolvedValueOnce({
      versions: [v('p1', 1, 'published'), v('p2', 2, 'published')],
      activeVersionId: 'p1',
    })
    const w = mount(Wrapper, {
      props: { projectId: PROJECT_ID, canManage: true },
      global,
    })
    await flushPromises()

    await w.find('[data-test="gt-button"]').trigger('click')
    await flushPromises()

    // Confirm was asked once; no POST hit the network.
    expect(confirmMock).toHaveBeenCalledTimes(1)
    const postCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/activate'),
    )
    expect(postCalls).toHaveLength(0)
    expect(w.emitted('activated')).toBeUndefined()
  })
})
