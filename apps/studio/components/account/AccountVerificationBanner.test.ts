// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import AccountVerificationBanner from './AccountVerificationBanner.vue'

// In oidc mode the banner reads the claim Studio stored at login and sends the
// person to the IdP; it never offers Better Auth's resend. Nothing shows until
// the source has answered.
vi.mock('~~/lib/auth-client', () => ({ authClient: { sendVerificationEmail: vi.fn() } }))
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))

const identity = (over: Record<string, unknown>) =>
  vi.stubGlobal('useAccountIdentity', () =>
    ref({
      mode: 'oidc',
      loaded: true,
      email: 'o@example.com',
      emailVerified: false,
      managedByIdp: true,
      ...over,
    }),
  )

const global = {
  components: {
    GTAlert: defineComponent({
      props: ['variant', 'heading'],
      setup(props, { slots }) {
        return () => h('div', { 'data-test': 'alert' }, [props.heading, slots.default?.()])
      },
    }),
    GTButton: defineComponent({
      setup(_p, { slots }) {
        return () => h('button', { 'data-test': 'resend' }, slots.default?.())
      },
    }),
  },
}

describe('AccountVerificationBanner', () => {
  it('oidc + unverified: shows the IdP hint and no resend button', () => {
    identity({})
    const w = mount(AccountVerificationBanner, { global })
    expect(w.find('[data-test="alert"]').exists()).toBe(true)
    expect(w.text()).toContain('account.verification.idp')
    expect(w.find('[data-test="resend"]').exists()).toBe(false)
  })

  it('oidc + verified claim: no banner', () => {
    identity({ emailVerified: true })
    expect(mount(AccountVerificationBanner, { global }).find('[data-test="alert"]').exists()).toBe(
      false,
    )
  })

  it('does not flash before the source has answered', () => {
    identity({ loaded: false })
    expect(mount(AccountVerificationBanner, { global }).find('[data-test="alert"]').exists()).toBe(
      false,
    )
  })

  it('better-auth + unverified: keeps the resend button', () => {
    identity({ mode: 'better-auth', managedByIdp: false })
    const w = mount(AccountVerificationBanner, { global })
    expect(w.find('[data-test="resend"]').exists()).toBe(true)
  })
})
