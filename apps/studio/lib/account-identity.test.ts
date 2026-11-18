import { describe, expect, it } from 'vitest'
import { resolveAccountIdentity } from './account-identity'

const none = { betterAuth: {}, oidc: { loaded: false } }

describe('resolveAccountIdentity', () => {
  it('better-auth mode reads the Better Auth session, as before', () => {
    const id = resolveAccountIdentity({
      mode: 'better-auth',
      betterAuth: { user: { email: 'a@example.com', emailVerified: true } },
      oidc: { loaded: true, user: { email: 'ignored@example.com', emailVerified: false } },
    })
    expect(id).toEqual({
      mode: 'better-auth',
      loaded: true,
      email: 'a@example.com',
      emailVerified: true,
      managedByIdp: false,
    })
  })

  it('oidc mode reads the stored claim and ignores the Better Auth session', () => {
    const id = resolveAccountIdentity({
      mode: 'oidc',
      betterAuth: { user: { email: 'ba@example.com', emailVerified: true } },
      oidc: { loaded: true, user: { email: 'o@example.com', emailVerified: false } },
    })
    expect(id).toMatchObject({
      mode: 'oidc',
      email: 'o@example.com',
      emailVerified: false,
      managedByIdp: true,
    })
  })

  it.each([undefined, null, false, 'true', 1])('treats emailVerified=%j as not verified', (v) => {
    expect(
      resolveAccountIdentity({
        mode: 'oidc',
        ...none,
        oidc: { loaded: true, user: { email: 'o@example.com', emailVerified: v as never } },
      }).emailVerified,
    ).toBe(false)
  })

  it('reports not loaded until the source answers, so no banner flashes', () => {
    expect(resolveAccountIdentity({ mode: 'oidc', ...none }).loaded).toBe(false)
    expect(
      resolveAccountIdentity({
        mode: 'better-auth',
        betterAuth: { pending: true },
        oidc: none.oidc,
      }).loaded,
    ).toBe(false)
  })
})
