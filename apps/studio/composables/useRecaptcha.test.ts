// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const RECAPTCHA_SITE_KEY = 'test-site-key'

vi.stubGlobal('useRuntimeConfig', () => ({
  public: { recaptchaSiteKey: RECAPTCHA_SITE_KEY },
}))

describe('executeRecaptcha', () => {
  beforeEach(() => {
    vi.resetModules()
    document.head.innerHTML = ''
    delete window.grecaptcha
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { recaptchaSiteKey: RECAPTCHA_SITE_KEY },
    }))
  })

  it('resolves when an existing reCAPTCHA script tag already finished loading', async () => {
    const script = document.createElement('script')
    script.dataset.recaptcha = 'true'
    Object.defineProperty(script, 'readyState', { value: 'complete' })
    document.head.appendChild(script)

    window.grecaptcha = {
      ready: (cb) => cb(),
      execute: vi.fn().mockResolvedValue('token-123'),
    }

    const { executeRecaptcha } = await import('~~/composables/useRecaptcha')

    await expect(executeRecaptcha('login')).resolves.toBe('token-123')
    expect(window.grecaptcha.execute).toHaveBeenCalledWith(RECAPTCHA_SITE_KEY, { action: 'login' })
  })

  it('waits for load when an existing reCAPTCHA script tag is still pending', async () => {
    const script = document.createElement('script')
    script.dataset.recaptcha = 'true'
    Object.defineProperty(script, 'readyState', { value: 'loading' })
    document.head.appendChild(script)

    window.grecaptcha = {
      ready: (cb) => cb(),
      execute: vi.fn().mockResolvedValue('token-456'),
    }

    const { executeRecaptcha } = await import('~~/composables/useRecaptcha')
    const pending = executeRecaptcha('signup')

    script.dispatchEvent(new Event('load'))

    await expect(pending).resolves.toBe('token-456')
  })
})
