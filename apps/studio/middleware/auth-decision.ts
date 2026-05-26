// Pure decision helper extracted from auth.global.ts so the routing logic
// is testable in isolation. The middleware wrapper handles the
// Nuxt-specific side effects (session fetch + navigateTo); this function
// just answers "given the current path, fullPath, and auth state, what
// should happen?".
//
// Three outcomes:
//   - 'allow'              — middleware lets the navigation through
//   - { redirect: '/x' }   — middleware should call navigateTo('/x')

const AUTH_PATHS: ReadonlySet<string> = new Set(['/login', '/signup'])

const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  ...AUTH_PATHS,
  '/verify-email',
  '/privacy',
  '/dpa',
  '/sub-processors',
  '/docs/install',
])

// Path prefixes that count as public — anything under /invitations/ (so
// invite-accept landings work unauthed) or /docs/ (any docs sub-page).
const PUBLIC_PREFIXES: readonly string[] = ['/invitations/', '/docs/']

export interface AuthDecision {
  type: 'allow' | 'redirect'
  to?: string
}

const ALLOW: AuthDecision = { type: 'allow' }

export function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))
}

export function isAuthPath(path: string): boolean {
  return AUTH_PATHS.has(path)
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
