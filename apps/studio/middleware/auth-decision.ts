// Pure decision helper extracted from auth.global.ts so the routing logic
// is testable in isolation. The middleware wrapper handles the
// Nuxt-specific side effects (session fetch + navigateTo); this function
// just answers "given the current path, fullPath, and auth state, what
// should happen?".
//
// ⚠️ THIS FILE IS THE UX LAYER, NOT THE SECURITY BOUNDARY.
// auth.global.ts starts with `if (import.meta.server) return`, so these
// decisions only run in the browser after hydration — they shape where a
// visitor is SENT, never what data they can obtain. Adding or removing a
// path here cannot expose anything.
//
// The real boundary for DATA is server/middleware/auth.ts plus the
// per-endpoint `if (!event.context.auth) throw 401` checks (~18 endpoints).
// That is why an unauthed SSR render of /dashboard or /plans returns an
// EMPTY shell rather than leaked content: the page renders, its data fetch
// 401s, and the UI falls back to defaults. /account and /orgs/** don't even
// SSR (routeRules ssr:false).
//
// Keep the two layers separate — that separation IS the defence in depth.
// A test asserting resolveAuthAction() returns 'redirect' proves the routing
// decision, never that data is protected; verify that at the endpoint layer.
// (Documented after [review]'s analysis of #194, 2026-08-04, so the next
// reader doesn't have to rediscover the distinction.)

const AUTH_PATHS: ReadonlySet<string> = new Set(['/login', '/signup'])

const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  ...AUTH_PATHS,
  '/verify-email',
  // Verify-tillidsflowet (#183): mail-linket rammer /verify, og modtageren er
  // per definition IKKE logget ind — uden disse to sender middlewaren dem til
  // /login, og flowet kan aldrig fuldføres. /verify/done skal ligeledes kunne
  // vise fejl-states (udløbet/ugyldigt link) uden session.
  '/verify',
  '/verify/done',
  '/forgot-password',
  '/reset-password',
  // 🔴 The footer links here from the AUTH layout too, so an unauthed visitor
  // on /login can click it — and the API behind it sets
  // `Cache-Control: public, max-age=300` and performs no auth check. Three
  // signals said public; only this list said otherwise, and it won on the
  // client while the server rendered the page 200. Found by [designer] on a
  // fresh-tab load: /changelog redirected to /login?redirect=/changelog while
  // curl returned the content.
  '/changelog',
  '/privacy',
  '/dpa',
  '/sub-processors',
  '/legal',
  '/docs/install',
])

// Path prefixes that count as public — anything under /invitations/ (so
// invite-accept landings work unauthed), /docs/ (any docs sub-page), or
// /legal/ (cookie-siden og fremtidige juridiske undersider: en legal-flade
// bag login giver aldrig mening, og prefikset gør at listen ikke driver fra
// ruterne når [jura] tilføjer en side).
const PUBLIC_PREFIXES: readonly string[] = ['/invitations/', '/docs/', '/legal/']

// Discriminated union so TypeScript narrows `to` to string in the
// 'redirect' branch — callers don't need an `&& decision.to` guard.
export type AuthDecision = { type: 'allow' } | { type: 'redirect'; to: string }

const ALLOW: AuthDecision = { type: 'allow' }

export function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))
}

export function isAuthPath(path: string): boolean {
  return AUTH_PATHS.has(path)
}

// The paths that are public because a flow LANDS there — a mail link, a reset
// token. They are mid-journey: the visitor has somewhere to go next, and a
// "back" control would compete with it.
const FLOW_PATHS: ReadonlySet<string> = new Set([
  '/verify-email',
  '/verify',
  '/verify/done',
  '/forgot-password',
  '/reset-password',
])

/**
 * A public page a visitor READS rather than passes through — the footer's
 * destinations.
 *
 * 🔴 WHY IT EXISTS ([designer], KH-1027): the shell-less public layout has no
 * way back. A visitor clicks /dpa in the footer of /login and is stranded:
 * there is no sidebar, no header, no link home. Measured: /dpa has none today.
 * The set is DERIVED here — public, minus the auth entry points, minus the
 * mid-flow landings — rather than listed in the layout, so a new footer page
 * inherits the way back instead of quietly not having one. The cell in
 * auth-decision.test.ts pins it against the footer's actual links.
 */
export function isInformationalPath(path: string): boolean {
  if (!isPublicPath(path)) return false
  if (isAuthPath(path)) return false
  return !FLOW_PATHS.has(path)
}

/**
 * Resolve the auth-aware redirect for a navigation. Pure — no I/O.
 *
 * - Unauthed user hitting a non-public path → redirect to /login with the
 *   intended path encoded as `?redirect=` so post-login the user lands
 *   where they were headed.
 * - Authed user hitting /login or /signup → redirect to /dashboard.
 *   They've already signed in; showing the auth form is just noise.
 * - Everything else → allow.
 */
export function resolveAuthAction(opts: {
  path: string
  fullPath: string
  authed: boolean
}): AuthDecision {
  if (!opts.authed && !isPublicPath(opts.path)) {
    return { type: 'redirect', to: `/login?redirect=${encodeURIComponent(opts.fullPath)}` }
  }
  if (opts.authed && isAuthPath(opts.path)) {
    return { type: 'redirect', to: '/dashboard' }
  }
  return ALLOW
}
