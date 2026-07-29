import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression guard for the v0.2.6 prod incident: this module is evaluated at
// import time, and when the bundler places it in a shared chunk loaded via
// dynamic import during SSR route navigation, that evaluation happens OUTSIDE
// the Nuxt async context — useRuntimeConfig() throws "[nuxt] instance
// unavailable" and every page importing auth-client 500s. The contract pinned
// here: importing the module must never require a Nuxt context.
describe('lib/auth-client module evaluation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('imports without a Nuxt context (useRuntimeConfig throwing)', async () => {
    vi.stubGlobal('useRuntimeConfig', () => {
      throw new Error('[nuxt] instance unavailable')
    })
    vi.stubEnv('NUXT_PUBLIC_AUTH_URL', 'https://studio.example.test')

    const mod = await import('./auth-client')
    expect(mod.authClient).toBeDefined()
    expect(mod.signIn).toBeDefined()
    expect(mod.organization).toBeDefined()
  })

  it('imports when no context AND no env fallback (browser path → origin default)', async () => {
    vi.stubGlobal('useRuntimeConfig', () => {
      throw new Error('[nuxt] instance unavailable')
    })
    vi.stubEnv('NUXT_PUBLIC_AUTH_URL', '')

    const mod = await import('./auth-client')
    expect(mod.authClient).toBeDefined()
  })

  it('prefers runtime config when the context IS available', async () => {
    const spy = vi.fn(() => ({ public: { authUrl: 'https://from-config.test' } }))
    vi.stubGlobal('useRuntimeConfig', spy)

    await import('./auth-client')
    expect(spy).toHaveBeenCalled()
  })
})
