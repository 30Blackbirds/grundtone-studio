// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineComponent, h, ref } from 'vue'
import ApiKeyManager from './ApiKeyManager.vue'
// Real ConfirmDialog (not a stub): the revoke tests exercise the actual
// open → confirm/cancel contract end-to-end against GTModal/GTButton stubs.
import ConfirmDialog from './ConfirmDialog.vue'

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
// It must also carry `locale` and `d`, because the real useI18n does: the
// component reads `locale.value` to format the "Created" column (R7, KH-1023).
// A stub narrower than the contract made the component throw in setup and
// render nothing — six cells failed on `expected ''`, which reads like a
// broken page rather than an incomplete stub.
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${JSON.stringify(params)})` : key,
  d: (date: Date) => date.toISOString(),
  locale: ref('en'),
}))

const writeTextMock = vi.fn(() => Promise.resolve())
vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } })

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

const GTModal = defineComponent({
  name: 'GTModal',
  props: ['open', 'title', 'persistent'],
  emits: ['update:open', 'close'],
  setup(props, { slots }) {
    return () =>
      props.open
        ? h('div', { 'data-test': 'gt-modal', 'data-title': props.title }, [
            slots.default?.(),
            slots.footer?.(),
          ])
        : null
  },
})

const global = {
  components: {
    GTButton,
    GTModal,
    ConfirmDialog,
    GTAlert: gtStub('GTAlert'),
    GTBadge: gtStub('GTBadge'),
    GTSelect: gtStub('GTSelect'),
    GTTextarea: gtStub('GTTextarea'),
    GTInput: gtStub('GTInput'),
    GTIcon: gtStub('GTIcon'),
    GTTooltip: gtStub('GTTooltip'),
    GTDetails: gtStub('GTDetails'),
    GTTable: defineComponent({
      name: 'GTTable',
      props: ['columns', 'rows', 'caption', 'responsive'],
      setup(props, { slots }) {
        return () =>
          h(
            'table',
            { 'data-test': 'gt-table' },
            (props.rows as Record<string, unknown>[]).map((row) =>
              h(
                'tr',
                (props.columns as { key: string }[]).map((c) =>
                  h(
                    'td',
                    slots[`cell-${c.key}`]?.({ row, value: row[c.key] }) ??
                      String(row[c.key] ?? ''),
                  ),
                ),
              ),
            ),
          )
      },
    }),
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
    keyType: 'publishable',
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
  writeTextMock.mockReset()
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
    // Only the always-available copy-project-id button renders; the create and
    // revoke buttons are both canManage-gated.
    const buttons = w.findAll('[data-test="gt-button"]')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].text()).toContain('apiKeys.copyId')
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
    const body = (
      postCall![1] as { body: { environment: string; rateLimit: number; keyType: string } }
    ).body
    expect(body.environment).toBe('live')
    expect(body.rateLimit).toBe(1000)
    // Defaults to a publishable key when the type toggle is untouched.
    expect(body.keyType).toBe('publishable')

    // Plaintext-shown-once alert should now be on screen.
    expect(w.text()).toContain('pk_live_full_secret')
    expect(w.text()).toContain('apiKeys.shownOnce')
  })

  it('copies the project id to the clipboard', async () => {
    fetchMock.mockResolvedValueOnce([])
    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: false }, global })
    await flushPromises()

    const copyBtn = w
      .findAll('[data-test="gt-button"]')
      .find((b) => b.text().includes('apiKeys.copyId'))
    expect(copyBtn).toBeDefined()
    await copyBtn!.trigger('click')
    await flushPromises()

    expect(writeTextMock).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('badges secret keys and keeps them out of the CDN install snippet', async () => {
    fetchMock.mockResolvedValueOnce([
      k({ id: 's', keyPrefix: 'sk_live_secret', keyType: 'secret' }),
    ])
    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()

    // Secret key is flagged in the list…
    expect(w.text()).toContain('apiKeys.secretBadge')
    // …and never feeds the publishable-only install snippet.
    expect(w.find('[data-test="install-snippet"]').attributes('data-api-key')).toBe('')
  })

  it('revoke: opens the confirm dialog, DELETEs on confirm, refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce([k({ id: 'a', keyPrefix: 'pk_live_x' })])
      .mockResolvedValueOnce(undefined) // DELETE response
      .mockResolvedValueOnce([k({ id: 'a', keyPrefix: 'pk_live_x', revokedAt: 'now' })])

    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()

    // Locate the revoke button by its label — the copy-project-id button shares
    // the outlined variant, so variant alone is no longer unambiguous.
    const revokeBtn = w
      .findAll('[data-test="gt-button"]')
      .find((b) => b.text().includes('apiKeys.revoke'))
    expect(revokeBtn).toBeDefined()
    await revokeBtn!.trigger('click')
    await flushPromises()

    // Dialog is open — no DELETE yet.
    const modal = w.find('[data-test="gt-modal"]')
    expect(modal.exists()).toBe(true)
    expect(
      fetchMock.mock.calls.filter(([, o]) => (o as { method?: string })?.method === 'DELETE'),
    ).toHaveLength(0)

    // Confirm (the destructive/negative button inside the dialog footer).
    const confirmBtn = modal
      .findAll('[data-test="gt-button"]')
      .find((b) => b.attributes('data-variant') === 'negative')
    expect(confirmBtn).toBeDefined()
    await confirmBtn!.trigger('click')
    await flushPromises()

    const deleteCall = fetchMock.mock.calls.find(
      ([url, opts]) =>
        typeof url === 'string' &&
        url.includes('/api-keys/a') &&
        (opts as { method?: string })?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    // Dialog closed after success.
    expect(w.find('[data-test="gt-modal"]').exists()).toBe(false)
  })

  it('revoke: cancelling the dialog aborts without a DELETE', async () => {
    fetchMock.mockResolvedValueOnce([k({ id: 'a' })])

    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()

    const revokeBtn = w
      .findAll('[data-test="gt-button"]')
      .find((b) => b.text().includes('apiKeys.revoke'))
    await revokeBtn!.trigger('click')
    await flushPromises()

    const modal = w.find('[data-test="gt-modal"]')
    expect(modal.exists()).toBe(true)
    const cancelBtn = modal
      .findAll('[data-test="gt-button"]')
      .find((b) => b.attributes('data-variant') === 'outlined')
    await cancelBtn!.trigger('click')
    await flushPromises()

    expect(w.find('[data-test="gt-modal"]').exists()).toBe(false)
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, opts]) => (opts as { method?: string })?.method === 'DELETE',
    )
    expect(deleteCalls).toHaveLength(0)
  })
})

describe('the R7 key table (KH-1023)', () => {
  // The existing cells pass on the CARD rendering alone, because the cards and
  // the table carry the same text — so without this, the table could render
  // nothing and every cell above would stay green.
  it('renders each active key as a table row with prefix, env and created date', async () => {
    fetchMock.mockResolvedValueOnce([
      k(),
      k({ id: 'k2', keyPrefix: 'pk_test_xyz', environment: 'test' }),
    ])
    const w = mount(Wrapper, { props: { projectId: PROJECT_ID, canManage: true }, global })
    await flushPromises()

    const table = w.find('[data-test="gt-table"]')
    expect(table.exists(), 'the table is not rendered at all').toBe(true)
    const rows = table.findAll('tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('pk_live_abc')
    expect(rows[0]!.text()).toContain('apiKeys.envLive')
    expect(rows[1]!.text()).toContain('pk_test_xyz')
    expect(rows[1]!.text()).toContain('apiKeys.envTest')
    // "Created" is a date with no clock (dayOnly), in the active locale.
    expect(rows[0]!.text()).toContain('May 19, 2026')
  })

  it('has no name column — api_keys has no name field yet', () => {
    // Pins the deliberate omission, so the column is added on purpose when
    // the schema change lands (routed via [sikkerhed]), not by accident.
    // cwd, not import.meta.url: this file runs under happy-dom, where
    // import.meta.url is not a file: URL and `new URL(...)` throws.
    const src = readFileSync(resolve(process.cwd(), 'components/ApiKeyManager.vue'), 'utf8')
    expect(src).not.toMatch(/key:\s*'name'/)
  })
})
