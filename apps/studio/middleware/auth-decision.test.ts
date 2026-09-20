import { describe, it, expect } from 'vitest'
import { isAuthPath, isInformationalPath, isPublicPath, resolveAuthAction } from './auth-decision'

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

  // 🔴 SAME DENOMINATOR, SECOND QUESTION. The footer decides which pages an
  // unauthed visitor can REACH; this cell decides which of them can get BACK.
  // [designer], KH-1027: a visitor clicks /dpa in the footer of /login and is
  // stranded — the shell-less layout has no sidebar, no header, no link home,
  // and /dpa has no way out today. Deriving the set from the footer means a new
  // footer page inherits the way back instead of quietly not having one.
  it('every internal footer destination also gets a way back', async () => {
    const { readFileSync } = await import('node:fs')
    const footer = readFileSync(new URL('../components/AppFooter.vue', import.meta.url), 'utf8')
    const links = [...new Set([...footer.matchAll(/to="(\/[^"]*)"/g)].map((m) => m[1]!))]

    expect(links.length, 'no internal footer links found; the reader is broken').toBeGreaterThan(3)

    for (const path of links) {
      expect(
        isInformationalPath(path),
        `${path} is reachable from the footer of /login, so it must carry a way back`,
      ).toBe(true)
    }
  })

  // The other direction, and the reason the predicate is not just
  // `isPublicPath`: on these the visitor is going FORWARD, and a competing
  // "back" control is worse than none.
  it('gives no way back on the auth entry points or the mid-flow landings', () => {
    for (const path of [
      '/login',
      '/signup',
      '/verify',
      '/verify/done',
      '/verify-email',
      '/forgot-password',
      '/reset-password',
    ]) {
      expect(isInformationalPath(path), path).toBe(false)
    }
  })

  it('gives no way back on a path that is not public at all', () => {
    // Otherwise the layout would offer "back to sign in" on a page only a
    // signed-in visitor can see.
    for (const path of ['/dashboard', '/account', '/orgs/acme']) {
      expect(isInformationalPath(path), path).toBe(false)
    }
  })

  // 🔴 ONE DECISION, TWO CALL SITES (KH-1034 / KH-1123). Since the signed-in
  // visitor now leaves /login on the SERVER, "where should this visitor go" is
  // asked in two places: middleware/auth.global.ts in the browser and
  // server/middleware/redirect-authed.ts in Nitro. A second, hand-rolled copy
  // in either of them would drift — and the drift would surface as exactly the
  // hydration mismatch the server redirect exists to remove, because the two
  // sides would render different pages for the same request.
  it('both auth call sites decide through resolveAuthAction, not their own copy', async () => {
    const { readFileSync } = await import('node:fs')
    const sites = [
      '../middleware/auth.global.ts',
      '../server/middleware/redirect-authed.ts',
    ] as const

    expect(sites.length, 'denominator: the files that decide a redirect').toBe(2)

    for (const site of sites) {
      const src = readFileSync(new URL(site, import.meta.url), 'utf8')
      expect(src, `${site} must import the shared decision`).toMatch(
        /import \{[^}]*resolveAuthAction[^}]*\} from '[^']*auth-decision'/,
      )
      // Re-deriving from the predicates instead of calling the decision is how
      // the copy would creep back in one innocent line at a time.
      for (const predicate of ['isAuthPath(', 'isPublicPath(']) {
        expect(src.includes(predicate), `${site} re-derives the decision via ${predicate}`).toBe(
          false,
        )
      }
    }
  })

  // 🔴 ORDERING IS LOAD-BEARING, AND IT FAILS CLOSED TO THE BUG.
  // server/middleware/redirect-authed.ts reads `event.context.auth`, which
  // server/middleware/auth.ts sets. Nitro runs server middleware in filename
  // order, so `auth.ts` must sort BEFORE it. If that ever stops being true the
  // context is empty, the visitor is treated as signed out, and /login renders
  // the form again — which is EXACTLY the state before the cure, so nothing
  // would look broken. This cell names the assumption so a rename cannot
  // quietly undo it.
  it('the auth middleware sorts before the middleware that reads its context', async () => {
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(new URL('../server/middleware', import.meta.url)).sort()

    expect(files, 'both middleware files must exist').toEqual(
      expect.arrayContaining(['auth.ts', 'redirect-authed.ts']),
    )
    expect(files.indexOf('auth.ts')).toBeLessThan(files.indexOf('redirect-authed.ts'))
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
