// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import AccountEmailForm from './AccountEmailForm.vue'

// Pins the verify-email-mismatch fix: Better Auth sends the change-email
// confirmation to the CURRENT address (ownership proof), so the success copy
// must reference the current email — not claim the mail went to the new one.
const changeEmailMock = vi.fn(async (_args: unknown) => ({ error: null }))
vi.mock('~~/lib/auth-client', () => ({
  changeEmail: (args: unknown) => changeEmailMock(args),
}))

vi.stubGlobal('useAccountIdentity', () =>
  ref({
    mode: 'better-auth',
    loaded: true,
    email: 'current@example.com',
    emailVerified: true,
    managedByIdp: false,
  }),
)
vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: 'https://studio.test' } }))
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${JSON.stringify(params)})` : key,
}))

const global = {
  components: {
    GTInput: defineComponent({
      props: ['modelValue', 'label', 'readonly'],
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        return () =>
          h('input', {
            'data-test': 'gt-input',
            value: props.modelValue,
            readonly: props.readonly,
            onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
          })
      },
    }),
    GTAlert: defineComponent({
      props: ['variant', 'heading'],
      setup(props) {
        return () =>
          h('div', { 'data-test': 'gt-alert', 'data-variant': props.variant }, props.heading)
      },
    }),
    GTButton: defineComponent({
      props: ['type', 'loading'],
      setup(props, { slots }) {
        return () => h('button', { type: props.type ?? 'button' }, slots.default?.())
      },
    }),
  },
  mocks: { $t: (k: string) => k },
}

describe('AccountEmailForm in oidc mode', () => {
  it('shows the stored e-mail and offers no change form: the IdP owns the address', async () => {
    vi.stubGlobal('useAccountIdentity', () =>
      ref({
        mode: 'oidc',
        loaded: true,
        email: 'o@example.com',
        emailVerified: false,
        managedByIdp: true,
      }),
    )
    try {
      const w = mount(AccountEmailForm, { global })
      expect(w.findAll('[data-test="gt-input"]')).toHaveLength(1)
      expect(w.find('form').exists()).toBe(false)
      expect(w.text()).toContain('account.email.managedByIdp')
      expect(w.text()).toContain('account.profile.emailNotVerified')
    } finally {
      vi.stubGlobal('useAccountIdentity', () =>
        ref({
          mode: 'better-auth',
          loaded: true,
          email: 'current@example.com',
          emailVerified: true,
          managedByIdp: false,
        }),
      )
    }
  })
})

describe('AccountEmailForm', () => {
  it('success copy references the CURRENT email (where the confirmation is sent)', async () => {
    const w = mount(AccountEmailForm, { global })
    const inputs = w.findAll('[data-test="gt-input"]')
    await inputs[1].setValue('new@example.com')
    await w.find('form').trigger('submit')
    await flushPromises()

    const alert = w.find('[data-test="gt-alert"][data-variant="success"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('account.email.pending')
    expect(alert.text()).toContain('current@example.com')
    expect(alert.text()).not.toContain('new@example.com')
  })

  it('always shows the flow hint about current-address confirmation', () => {
    const w = mount(AccountEmailForm, { global })
    expect(w.text()).toContain('account.email.flowHint')
  })
})
