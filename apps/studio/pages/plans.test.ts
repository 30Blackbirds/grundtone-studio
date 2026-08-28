// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, Suspense } from 'vue'

import Plans from './plans.vue'

// Lukker det gab [review] navngav: `beta-copy.test.ts` pinner STRENGENE, men
// intet målte at badgen faktisk står dér, hvor købs-knappen ellers stod.
// Kæden `v-else-if="plan.purchasable"` → `v-if="BETA_MODE" disabled` var læst,
// ikke målt — og en `v-if`-swap ville have været usynlig.

vi.stubGlobal('definePageMeta', vi.fn())
vi.stubGlobal('navigateTo', vi.fn())
vi.stubGlobal('useRoute', () => ({ query: {} }))
vi.stubGlobal('useRequestHeaders', () => ({}))
vi.stubGlobal('useAsyncData', async (_k: string, fn: () => Promise<unknown>) => ({
  data: { value: await fn() },
}))
vi.stubGlobal('$fetch', async () => ({ orgs: [], projects: [], activity: [] }))
vi.stubGlobal('useI18n', () => ({
  // Nøglen returneres som sin egen værdi, så testen måler HVILKEN nøgle der
  // renderes hvor — ikke om oversættelsen er den rigtige. Det gør
  // `beta-copy.test.ts` allerede, og den gør det bedre (ordret mod forlægget).
  t: (key: string) => key,
}))

function stub(name: string, tag = 'div') {
  return defineComponent({
    name,
    props: ['variant', 'size', 'block', 'disabled', 'heading', 'modelValue'],
    emits: ['update:modelValue', 'click'],
    setup(props, { slots }) {
      return () =>
        h(tag, { 'data-stub': name, 'data-disabled': props.disabled ? 'true' : 'false' }, slots)
    },
  })
}

async function mountPlans() {
  const wrapper = mount(
    defineComponent({
      setup: () => () => h(Suspense, null, { default: () => h(Plans) }),
    }),
    {
      global: {
        stubs: {
          GTButton: stub('GTButton', 'button'),
          GTAlert: stub('GTAlert'),
          GTBadge: stub('GTBadge', 'span'),
          GTCheckbox: stub('GTCheckbox'),
          GTDetails: stub('GTDetails'),
          GTInput: stub('GTInput'),
          GTModal: stub('GTModal'),
          GTSelect: stub('GTSelect'),
          NuxtLink: stub('NuxtLink', 'a'),
        },
      },
    },
  )
  await flushPromises()
  return wrapper
}

describe('plans.vue under beta (Beslutning AL)', () => {
  it('viser badge-nøglen dér hvor en betalt plans CTA ellers stod', async () => {
    const html = (await mountPlans()).html()
    expect(html).toContain('plans.beta.comingSoon')
  })

  // 🔴 Den egentlige påstand: købs-CTA'en er BORTE, ikke bare suppleret.
  // Uden denne ville en badge tilføjet VED SIDEN AF knappen bestå testen
  // ovenfor — og fladen ville stadig kunne købes.
  it('renderer ingen købs-CTA for de betalte planer', async () => {
    const html = (await mountPlans()).html()
    expect(html).not.toContain('plans.ctaChoose')
  })

  it('viser beta-noticen', async () => {
    const html = (await mountPlans()).html()
    expect(html).toContain('plans.beta.notice')
  })

  // Positiv kontrol: siden renderer faktisk planer. Uden den ville alle
  // assertions ovenfor bestå mod en side der fejlede stille og gengav intet.
  it('renderer rent faktisk plan-kortene', async () => {
    const html = (await mountPlans()).html()
    expect(html).toContain('plans.names.studio_solo')
    expect(html).toContain('plans.names.studio_scale')
  })
})
