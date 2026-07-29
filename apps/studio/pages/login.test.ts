// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import Login from './login.vue'

// Pins task #13: the login page's magic-link path — send via
// signIn.magicLink with the shared email field + redirect callback, show the
// sent-state, and refuse to fire without an email.
const magicLinkMock = vi.fn(async (_args: unknown) => ({ error: null }))
vi.mock('~~/lib/auth-client', () => ({
  signIn: {
    email: vi.fn(async (_args: unknown) => ({ error: null })),
    magicLink: (args: unknown) => magicLinkMock(args),
  },
}))
vi.mock('~~/composables/useAltcha', () => ({
  solveAltchaChallenge: vi.fn(async () => 'altcha-token'),
}))

vi.stubGlobal('useRoute', () => ({ query: {} }))
vi.stubGlobal('navigateTo', vi.fn())
vi.stubGlobal('definePageMeta', vi.fn())
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${JSON.stringify(params)})` : key,
}))

function stub(name: string, tag = 'div') {
  return defineComponent({
    name,
    props: ['modelValue', 'label', 'variant', 'heading', 'loading', 'type', 'block', 'title'],
    emits: ['update:modelValue', 'click'],
    setup(props, { slots, emit }) {
      return () =>
        h(
          tag,
          {
            'data-test': name,
            'data-heading': props.heading,
            onClick: () => emit('click'),
            ...(tag === 'input'
              ? {
                  value: props.modelValue,
                  onInput: (e: Event) =>
                    emit('update:modelValue', (e.target as HTMLInputElement).value),
                }
              : {}),
          },
          [props.heading, slots.default?.()],
        )
    },
  })
}

const global = {
  components: {
    AuthCard: defineComponent({
      props: ['title'],
      setup(_, { slots }) {
        return () => h('div', slots.default?.())
      },
    }),
    GTInput: stub('GTInput', 'input'),
    GTPasswordInput: stub('GTPasswordInput', 'input'),
    GTAlert: stub('GTAlert'),
    GTButton: stub('GTButton', 'button'),
  },
  mocks: { $t: (k: string) => k },
  stubs: { NuxtLink: { template: '<a><slot /></a>' } },
}

function magicButton(w: ReturnType<typeof mount>) {
  return w.findAll('[data-test="GTButton"]').find((b) => b.text().includes('magicLink.send'))!
}

beforeEach(() => magicLinkMock.mockClear())

describe('login magic-link', () => {
  it('sends the link with the shared email + redirect callback and shows sent-state', async () => {
    const w = mount(Login, { global })
    await w.find('[data-test="GTInput"]').setValue('allan@klanghaus.dk')
    await magicButton(w).trigger('click')
    await flushPromises()

    expect(magicLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'allan@klanghaus.dk',
        callbackURL: '/dashboard',
        fetchOptions: { headers: { 'x-captcha-response': 'altcha-token' } },
      }),
    )
    expect(w.text()).toContain('magicLink.sentHeading')
    expect(w.text()).toContain('allan@klanghaus.dk')
  })

  it('refuses to send without an email — inline error, no call', async () => {
    const w = mount(Login, { global })
    await magicButton(w).trigger('click')
    await flushPromises()

    expect(magicLinkMock).not.toHaveBeenCalled()
    expect(w.text()).toContain('magicLink.emailRequired')
  })
})
