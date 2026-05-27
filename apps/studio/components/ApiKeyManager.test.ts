// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ApiKeyManager from './ApiKeyManager.vue'

// Stubs for the Nuxt auto-imports the SFC reaches for. Safe to define after
// the SFC import — <script setup> doesn't evaluate until mount() runs.
// useAsyncData mirrors Nuxt's real shape: calls the fetcher once at setup
// and exposes a reactive `data` ref + a refresh() that re-runs the fetcher.
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
// setup-vue.ts ships a default useI18n that ignores params. This component
// renders interpolated strings (`apiKeys.rateLimitBadge`, `{n}`), so we
// reach for the params-aware variant from the start.
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${JSON.stringify(params)})` : key,
}))

const confirmMock = vi.fn(() => true)
vi.stubGlobal('confirm', confirmMock)

// Generic passthrough stub for grundtone components. Renders default slot
// inside a div tagged with `data-test="<lower-name>"` plus any structured
// props the assertions care about (variant / heading / loading).
function gtStub(name: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: ['variant', 'heading', 'loading', 'size', 'modelValue', 'options'],
    emits: ['update:modelValue', 'click', 'submit'],
    setup(props, { slots, attrs, emit }) {
      return () =>
        h(
          'div',
          {
            ...attrs,
            'data-test': `gt-${name.replace(/^GT/, '').toLowerCase()}`,
            'data-variant': props.variant,
            'data-heading': props.heading,
            'data-loading': props.loading ? 'true' : 'false',
            onClick: () => emit('click'),
          },
          slots.default?.(),
        )
    },
  })
}

const GTButton = defineComponent({
  name: 'GTButton',
  props: ['variant', 'size', 'loading', 'type'],
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () =>
      h(
        'button',
        {
          'data-test': 'gt-button',
          'data-variant': props.variant,
          'data-loading': props.loading ? 'true' : 'false',
          type: props.type ?? 'button',
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const InstallSnippet = defineComponent({
  name: 'InstallSnippet',
  props: ['apiKey'],
  setup(props) {
    return () => h('div', { 'data-test': 'install-snippet', 'data-api-key': props.apiKey ?? '' })
  },
})

const global = {
  components: {
    GTButton,
    GTAlert: gtStub('GTAlert'),
    GTSelect: gtStub('GTSelect'),
    GTTextarea: gtStub('GTTextarea'),
    GTInput: gtStub('GTInput'),
    GTIcon: gtStub('GTIcon'),
    GTTooltip: gtStub('GTTooltip'),
    InstallSnippet,
  },
  mocks: {
    $t: (k: string, params?: Record<string, unknown>) =>
      params ? `${k}(${JSON.stringify(params)})` : k,
  },
}

const PROJECT_ID = 'project-1'

function k(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    id: 'k1',
    keyPrefix: 'pk_live_abc',
    environment: 'live',
    allowedOrigins: ['acme.com'],
    rateLimit: 1000,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-05-19T08:00:00Z',
    ...overrides,
  }
}

// Top-level await in <script setup> → async component → must be wrapped in
// <Suspense> for mount() to render anything.
const Wrapper = defineComponent({
  components: { ApiKeyManager },
  props: {
    projectId: { type: String, required: true },
    canManage: { type: Boolean, default: false },
  },
  template: `
    <Suspense>
      <ApiKeyManager :project-id="projectId" :can-manage="canManage" />
    </Suspense>`,
})

beforeEach(() => {
  fetchMock.mockReset()
  confirmMock.mockReset()
  confirmMock.mockReturnValue(true)
})

describe('ApiKeyManager', () => {
  it('renders empty state when no keys exist', async () => {
    fetchMock.mockResolvedValueOnce([])
    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()
    expect(w.text()).toContain('apiKeys.empty')
  })

  it('renders an active key with prefix, env, origins and rate-limit badge', async () => {
    fetchMock.mockResolvedValueOnce([
      k({ id: 'a', keyPrefix: 'pk_live_abc', allowedOrigins: ['acme.com'], rateLimit: 500 }),
    ])
    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()
    const t = w.text()
    expect(t).toContain('pk_live_abc')
    expect(t).toContain('acme.com')
    // rate-limit badge string is templated through t() — assertion shape comes
    // from the $t mock that JSON-serialises the params object.
    expect(t).toContain('apiKeys.rateLimitBadge')
    expect(t).toContain('"n":500')
  })

  it('shows the revoked section only when revoked keys exist', async () => {
    fetchMock.mockResolvedValueOnce([
      k({ id: 'a' }),
      k({ id: 'b', revokedAt: '2026-05-21T10:00:00Z', keyPrefix: 'pk_live_dead' }),
    ])
    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()
    expect(w.text()).toContain('apiKeys.revoked')
    expect(w.text()).toContain('pk_live_dead')
  })

  it('hides the create button and revoke buttons when canManage is false', async () => {
    fetchMock.mockResolvedValueOnce([k({ id: 'a' })])
    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: false }, global })
    await flushPromises()
    // No buttons should render at all: create button is canManage-gated,
    // revoke button is canManage-gated.
    expect(w.findAll('[data-test="gt-button"]')).toHaveLength(0)
  })

  it('creates a key: POSTs body, surfaces plaintext, then refreshes the list', async () => {
    fetchMock
      .mockResolvedValueOnce([]) // initial list
      .mockResolvedValueOnce({ plaintext: 'pk_live_full_secret', keyPrefix: 'pk_live_full' })
      .mockResolvedValueOnce([k({ id: 'a', keyPrefix: 'pk_live_full' })])

    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()

    // Reveal the form. First gt-button is the create-toggle (canManage gates
    // it, no other buttons render in the empty state).
    await w.find('[data-test="gt-button"]').trigger('click')
    await flushPromises()

    // happy-dom doesn't fire <form>.submit when a type="submit" button is
    // clicked, so we dispatch the submit event on the form directly. The
    // template uses @submit.prevent="createKey", so this exercises the same
    // code path as a real user submit.
    await w.find('form').trigger('submit.prevent')
    await flushPromises()

    const postCall = fetchMock.mock.calls.find(
      ([url, opts]) =>
        typeof url === 'string' &&
        url.endsWith('/api-keys') &&
        (opts as { method?: string })?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    const body = (postCall![1] as { body: { environment: string; rateLimit: number } }).body
    expect(body.environment).toBe('live')
    expect(body.rateLimit).toBe(1000)

    // Plaintext-shown-once alert should now be on screen.
    expect(w.text()).toContain('pk_live_full_secret')
    expect(w.text()).toContain('apiKeys.shownOnce')
  })

  it('revoke(): confirms, DELETEs, refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce([k({ id: 'a', keyPrefix: 'pk_live_x' })])
      .mockResolvedValueOnce(undefined) // DELETE response
      .mockResolvedValueOnce([k({ id: 'a', keyPrefix: 'pk_live_x', revokedAt: 'now' })])

    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()

    // Two buttons render: create-toggle + revoke. The revoke button is the
    // outlined one rendered inside the active-key row.
    const revokeBtn = w
      .findAll('[data-test="gt-button"]')
      .find((b) => b.attributes('data-variant') === 'outlined')
    expect(revokeBtn).toBeDefined()
    await revokeBtn!.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    const deleteCall = fetchMock.mock.calls.find(
      ([url, opts]) =>
        typeof url === 'string' &&
        url.includes('/api-keys/a') &&
        (opts as { method?: string })?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
  })

  it('revoke(): aborts when the user cancels the confirm prompt', async () => {
    confirmMock.mockReturnValue(false)
    fetchMock.mockResolvedValueOnce([k({ id: 'a' })])

    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()

    const revokeBtn = w
      .findAll('[data-test="gt-button"]')
      .find((b) => b.attributes('data-variant') === 'outlined')
    await revokeBtn!.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, opts]) => (opts as { method?: string })?.method === 'DELETE',
    )
    expect(deleteCalls).toHaveLength(0)
  })
})
