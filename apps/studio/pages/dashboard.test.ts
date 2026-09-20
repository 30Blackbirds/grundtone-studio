// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref, Suspense, type Ref } from 'vue'

import Dashboard from './dashboard.vue'
import type { DashboardPayload } from '~~/server/lib/dashboard'

// 🔴 THE CONDITION THIS FILE EXISTS FOR (KH-1034 / KH-1123, [designer]):
// "the user has no organizations" must be true of an ANSWER THE SERVER GAVE,
// never of the value the page starts with.
//
// The defect it pins: a signed-in visitor loading /login directly was
// redirected into /dashboard DURING HYDRATION, and `useAsyncData` (nuxt
// 3.21.11, dist/app/composables/asyncData.js:114) short-circuits in that state
// — `fetchOnServer && isHydrating && data.value != null` marks the data
// `success` and never calls the handler. The page's own
// `default: () => ({ orgs: [], ... })` was what made `data.value` non-null, so
// the page read "zero orgs" off its own fallback and sent a user who HAD an
// organization into the onboarding wizard.
//
// WHAT THIS CELL FAITHFULLY REPRODUCES, and what it does not: it reproduces
// the OBSERVABLE CONTRACT of that short-circuit — the handler is not called
// and `data.value` is whatever `default()` returned. It does NOT run Nuxt's
// own asyncData. If Nuxt changes when it short-circuits, this file will not
// notice; what it pins is that the PAGE cannot decide a destination from a
// value it was merely initialised with.

const navigateTo = vi.fn()

/** The real payload shape, with an organization — the user in the bug report. */
const WITH_ORG: DashboardPayload = {
  orgs: [{ id: 'o1', name: 'Local Design Review', slug: 'local-design-review' }],
  projects: [],
  activity: [],
} as unknown as DashboardPayload

/** A real answer from a genuinely new user. Indistinguishable from the OLD
 *  default — which is exactly why the old default could not be trusted. */
const WITHOUT_ORG: DashboardPayload = { orgs: [], projects: [], activity: [] }

let handlerCalls = 0
let dataRef: Ref<DashboardPayload | null>

/**
 * @param shortCircuit when true, behave like Nuxt during hydration: DO NOT call
 *                     the handler, and hand back `options.default()`.
 */
function stubUseAsyncData(shortCircuit: boolean, answer: DashboardPayload) {
  vi.stubGlobal(
    'useAsyncData',
    async (
      _key: string,
      handler: () => Promise<DashboardPayload>,
      options: { default: () => DashboardPayload | null },
    ) => {
      if (shortCircuit) {
        dataRef = ref(options.default())
      } else {
        handlerCalls += 1
        dataRef = ref(await handler())
      }
      void answer
      return { data: dataRef, refresh: vi.fn() }
    },
  )
}

function stub(name: string, tag = 'div') {
  return defineComponent({
    name,
    props: ['variant', 'size', 'to', 'heading', 'modelValue', 'disabled'],
    setup:
      (_p, { slots }) =>
      () =>
        h(tag, { 'data-stub': name }, slots),
  })
}

async function mountDashboard() {
  const wrapper = mount(
    defineComponent({ setup: () => () => h(Suspense, null, { default: () => h(Dashboard) }) }),
    {
      global: {
        stubs: {
          GTButton: stub('GTButton', 'button'),
          GTAlert: stub('GTAlert'),
          GTBadge: stub('GTBadge', 'span'),
          GTCard: stub('GTCard'),
          GTIcon: stub('GTIcon', 'span'),
          GTInput: stub('GTInput'),
          GTModal: stub('GTModal'),
          GTEmptyState: stub('GTEmptyState'),
          NuxtLink: stub('NuxtLink', 'a'),
        },
      },
    },
  )
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  navigateTo.mockClear()
  handlerCalls = 0
  vi.stubGlobal('definePageMeta', vi.fn())
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('useRequestHeaders', () => ({}))
  vi.stubGlobal('refreshNuxtData', vi.fn())
  vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }))
  vi.stubGlobal('$fetch', async () => WITH_ORG)
})

describe('the onboarding decision', () => {
  it('does NOT redirect when the data was never fetched', async () => {
    // The exact state the defect ran in: Nuxt short-circuited, so the page
    // holds only what `default()` returned. Under the OLD default that value
    // was `{ orgs: [] }` and this redirected a user who had an organization.
    stubUseAsyncData(true, WITH_ORG)
    await mountDashboard()

    expect(handlerCalls, 'the short-circuit must not call the handler').toBe(0)
    expect(dataRef.value, 'the default must not look like a real empty answer').toBeNull()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('redirects when the SERVER says the user has no organizations', async () => {
    // The negative control for the cell above: if it only ever asserted "no
    // redirect", deleting the redirect entirely would leave it green.
    vi.stubGlobal('$fetch', async () => WITHOUT_ORG)
    stubUseAsyncData(false, WITHOUT_ORG)
    await mountDashboard()

    expect(handlerCalls).toBe(1)
    expect(navigateTo).toHaveBeenCalledWith('/onboarding')
  })

  it('stays on the dashboard when the server returns an organization', async () => {
    stubUseAsyncData(false, WITH_ORG)
    await mountDashboard()

    expect(handlerCalls).toBe(1)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('redirects when the answer arrives AFTER mount', async () => {
    // The redirect path resolves the fetch after the component is mounted, so
    // a one-shot onMounted check would read `null` and decide nothing. This is
    // why the watcher exists rather than a bare `if` in onMounted.
    stubUseAsyncData(true, WITHOUT_ORG)
    await mountDashboard()
    expect(navigateTo).not.toHaveBeenCalled()

    dataRef.value = WITHOUT_ORG
    await flushPromises()
    expect(navigateTo).toHaveBeenCalledWith('/onboarding')
  })
})
