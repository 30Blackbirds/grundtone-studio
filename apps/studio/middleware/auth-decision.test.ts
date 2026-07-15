import { describe, it, expect } from 'vitest'
import { isAuthPath, isPublicPath, resolveAuthAction } from './auth-decision'

describe('isPublicPath', () => {
  it.each([
    ['/login', true],
    ['/signup', true],
    ['/verify-email', true],
    ['/forgot-password', true],
    ['/reset-password', true],
    ['/privacy', true],
    ['/dpa', true],
    ['/sub-processors', true],
    ['/docs/install', true],
    // Prefix matches
    ['/docs/getting-started', true],
    ['/invitations/abc-123', true],
    ['/invitations/project/some-uuid', true],
    // Not public
    ['/dashboard', false],
    ['/orgs/acme', false],
    ['/orgs/acme/projects/main', false],
    ['/audit', false],
    ['/', false],
  ])('returns %s for "%s"', (path, expected) => {
    expect(isPublicPath(path as string)).toBe(expected as boolean)
  })
})

describe('isAuthPath', () => {
  it.each([
    ['/login', true],
    ['/signup', true],
    // The auth forms themselves only — not /verify-email (that's a public
    // landing page, not a form).
    ['/verify-email', false],
    ['/dashboard', false],
    ['/login?redirect=/foo', false],
  ])('returns %s for "%s"', (path, expected) => {
    expect(isAuthPath(path as string)).toBe(expected as boolean)
  })
})

describe('resolveAuthAction — unauthenticated', () => {
  const authed = false

  it('allows public paths through without redirect', () => {
    expect(resolveAuthAction({ path: '/login', fullPath: '/login', authed })).toEqual({
      type: 'allow',
    })
    expect(resolveAuthAction({ path: '/privacy', fullPath: '/privacy', authed })).toEqual({
      type: 'allow',
    })
    expect(
      resolveAuthAction({ path: '/invitations/abc', fullPath: '/invitations/abc', authed }),
    ).toEqual({ type: 'allow' })
  })

  it('redirects to /login when hitting a protected path', () => {
    expect(resolveAuthAction({ path: '/dashboard', fullPath: '/dashboard', authed })).toEqual({
      type: 'redirect',
      to: '/login?redirect=%2Fdashboard',
    })
  })

  it('preserves query + hash in the redirect via fullPath', () => {
    const decision = resolveAuthAction({
      path: '/orgs/acme/projects/main',
      fullPath: '/orgs/acme/projects/main?tab=tokens#section-2',
      authed,
    })
    expect(decision).toEqual({
      type: 'redirect',
      to: '/login?redirect=%2Forgs%2Facme%2Fprojects%2Fmain%3Ftab%3Dtokens%23section-2',
    })
  })

  it('escapes any characters that would break ?redirect= parsing', () => {
    // Path containing a literal & must end up percent-encoded so the
    // intended path arrives intact at /login.
    const decision = resolveAuthAction({
      path: '/orgs/a&b',
      fullPath: '/orgs/a&b',
      authed,
    })
    expect(decision).toEqual({ type: 'redirect', to: '/login?redirect=%2Forgs%2Fa%26b' })
  })
})

describe('resolveAuthAction — authenticated', () => {
  const authed = true

  it('redirects /login + /signup to /dashboard (already signed in)', () => {
    expect(resolveAuthAction({ path: '/login', fullPath: '/login', authed })).toEqual({
      type: 'redirect',
      to: '/dashboard',
    })
    expect(resolveAuthAction({ path: '/signup', fullPath: '/signup', authed })).toEqual({
      type: 'redirect',
      to: '/dashboard',
    })
  })

  it('allows any other path through (including public ones)', () => {
    // /privacy is public; an authed user reading it should not be bounced.
    expect(resolveAuthAction({ path: '/privacy', fullPath: '/privacy', authed })).toEqual({
      type: 'allow',
    })
    expect(resolveAuthAction({ path: '/dashboard', fullPath: '/dashboard', authed })).toEqual({
      type: 'allow',
    })
    expect(
      resolveAuthAction({
        path: '/orgs/acme/audit',
        fullPath: '/orgs/acme/audit?action=member.invited',
        authed,
      }),
    ).toEqual({ type: 'allow' })
  })

  it('allows verify-email through for an authed user', () => {
    // Some flows park a freshly-signed-up user on /verify-email even though
    // their session may already exist — we should never bounce them off it.
    expect(
      resolveAuthAction({
        path: '/verify-email',
        fullPath: '/verify-email?email=foo%40bar.dk',
        authed,
      }),
    ).toEqual({ type: 'allow' })
  })
})
