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

// Drift-sikring (projektleder-krav 2026-08-04 efter [review]s bifund, udvidet
// med et prod-fund undervejs): PUBLIC_PATHS er en håndholdt liste, og hver
// gang nogen tilføjer en side der skal kunne nås UDEN login, kan listen glide
// fra ruterne. Det skete to gange: /legal (nyt indeks) og — alvorligere —
// /verify + /verify/done fra verify-tillidsflowet, hvor modtageren af
// mail-linket per definition ikke er logget ind. Testen læser pages/-træet,
// så en ny fil under de her mapper tvinger et bevidst valg.
describe('unauthed reachability (drift guard)', () => {
  const MUST_BE_PUBLIC = [
    '/privacy',
    '/dpa',
    '/sub-processors',
    '/legal',
    '/legal/cookies',
    '/verify',
    '/verify/done',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/login',
    '/signup',
  ]

  it.each(MUST_BE_PUBLIC)('%s is reachable without a session', (path) => {
    expect(resolveAuthAction({ path, fullPath: path, authed: false })).toEqual({ type: 'allow' })
  })

  // 🔴 DERIVED FROM THE HAZARD, NOT FROM MEMORY (third instance of this drift).
  // The list above is hand-held, and it has now drifted three times: /legal,
  // then /verify + /verify/done, then /changelog — found by [designer] loading
  // it in a fresh tab and being redirected to /login?redirect=/changelog while
  // curl returned the page with 200. Two answers about one page.
  //
  // AppFooter is rendered by layouts/auth.vue as well as layouts/app.vue, so
  // every internal link in it is clickable by a visitor who is NOT logged in.
  // That makes the footer the denominator: read it from disk, and a new link
  // forces a deliberate choice instead of a silent redirect.
  it('every internal link in the footer is reachable without a session', async () => {
    const { readFileSync } = await import('node:fs')
    const footer = readFileSync(new URL('../components/AppFooter.vue', import.meta.url), 'utf8')
    const links = [...new Set([...footer.matchAll(/to="(\/[^"]*)"/g)].map((m) => m[1]))]

    // The guard must not pass by finding no links at all — that is how a
    // refactor of the footer would silently disarm it.
    expect(links.length, 'no internal footer links found; the reader is broken').toBeGreaterThan(3)

    for (const path of links) {
      expect(
        resolveAuthAction({ path, fullPath: path, authed: false }),
        `${path} is linked from the footer shown on /login, so it must not redirect`,
      ).toEqual({ type: 'allow' })
    }
  })

  it('every page under pages/legal/ is public', async () => {
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(new URL('../pages/legal', import.meta.url))
    const routes = files
      .filter((f) => f.endsWith('.vue'))
      .map((f) => (f === 'index.vue' ? '/legal' : `/legal/${f.replace(/\.vue$/, '')}`))
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect(
        resolveAuthAction({ path: route, fullPath: route, authed: false }),
        `${route} must be public — a legal page behind login is never right`,
      ).toEqual({ type: 'allow' })
    }
  })

  it('every page under pages/verify/ is public (mail recipients have no session)', async () => {
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(new URL('../pages/verify', import.meta.url))
    const routes = files
      .filter((f) => f.endsWith('.vue'))
      .map((f) => (f === 'index.vue' ? '/verify' : `/verify/${f.replace(/\.vue$/, '')}`))
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect(
        resolveAuthAction({ path: route, fullPath: route, authed: false }),
        `${route} must be public — the verify link lands here before any session exists`,
      ).toEqual({ type: 'allow' })
    }
  })

  // NB: dette er en UX-assertion, ikke en sikkerheds-assertion. Den beviser
  // at en uautentificeret besøgende bliver SENDT til login — ikke at data er
  // beskyttet. Data-grænsen er server/middleware/auth.ts + per-endpoint
  // 401-tjek, og den testes dér. Se filhovedet i auth-decision.ts.
  it('still routes the authenticated app to login (UX layer, not the data boundary)', () => {
    for (const path of ['/dashboard', '/account', '/orgs/acme', '/plans']) {
      expect(resolveAuthAction({ path, fullPath: path, authed: false }).type).toBe('redirect')
    }
  })
})
