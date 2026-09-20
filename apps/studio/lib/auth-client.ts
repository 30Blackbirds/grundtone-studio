import { createAuthClient } from 'better-auth/vue'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'

// Studio consumes the CENTRAL auth service — but in prod it goes through
// studio's OWN origin (BFF): NUXT_PUBLIC_AUTH_URL=https://studio.grundtone.com
// so every auth call hits /api/auth/** here, which server/api/auth/[...].ts
// proxies to the auth deployment. That keeps the session cookie FIRST-party on
// grundtone.com — calling api.klanghaus.dk directly makes it a third-party
// cookie that browsers reject (SameSite=Lax cross-site). Locally, Tilt points
// this straight at the auth container's URL (same-site on localhost, no proxy
// needed). Studio no longer runs Better Auth server-side.
function authBaseURL(): string | undefined {
  // This module is evaluated at import time, and the CHUNK GRAPH decides the
  // import context: when auth-client lands in a shared chunk that's loaded via
  // dynamic import during SSR route navigation, evaluation happens OUTSIDE the
  // Nuxt async context and useRuntimeConfig() throws "[nuxt] instance
  // unavailable" — which 500'd /login, /signup and /dashboard on v0.2.6 (the
  // redesign reshuffled the chunks). Never depend on Nuxt context at module
  // scope: fall back to the same env var that feeds runtime config. In the
  // browser process.env is empty → undefined → better-auth defaults to
  // window.location.origin, which IS the BFF origin we want.
  try {
    const url = useRuntimeConfig().public.authUrl
    return url || undefined
  } catch {
    return process.env.NUXT_PUBLIC_AUTH_URL || undefined
  }
}

// 🔴 A GAP IN THE LOCAL DESIGN-REVIEW STUB MUST SAY SO ON SCREEN.
//
// Measured 2026-09-20: of the 28 auth paths studio calls, the bypass stub
// answers 6 and 501s 22 — and 18 of those are reachable by clicking. Until
// this hook existed every one of them was a button that did nothing at all,
// and a silent button is indistinguishable from a broken product. [designer]
// reported one of them as a product defect, which is exactly the failure this
// prevents: the reviewer spends their attention deciding whether the scaffold
// is the thing being reviewed.
//
// It keys on `devAuthBypass`, a marker only server/api/auth/[...].ts's bypass
// branch emits — never on the status code alone. A genuine 501 from the real
// auth service in production therefore cannot be dressed up as a design-review
// gap, and this code is inert rather than merely gated.
//
// The string is deliberately English and deliberately bracketed. It is
// scaffolding, not product copy: it must be unmistakable as something that
// cannot ship, and it must never travel through the i18n files where it would
// be reviewed and translated as if it were a product message.
function reportDevAuthGap(error: Record<string, unknown> | undefined): void {
  const data = error?.data as
    | { devAuthBypass?: boolean; path?: string; group?: 'never' | 'on-request' }
    | undefined
  if (data?.devAuthBypass !== true) return

  // Two messages, because the two groups are not the same promise. 'never' is
  // a decision ([sikkerhed]): actions that change a right, an invitation or a
  // session stay dead here, because a stub that returns success would teach a
  // reviewer that the action worked.
  const message =
    data.group === 'never'
      ? `[design review] "${data.path}" stays disabled here — it would change a session, ` +
        `a right or an invitation, and a fake success is worse than a dead button.`
      : `[design review] "${data.path}" is not stubbed locally yet. Ask [grundtone] if you ` +
        `need this flow.`

  // The auto-imported useToast — the same module instance GTToastContainer
  // reads. An explicit import from '@grundtone/vue' resolves to dist/ and its
  // toasts never render (KH-1042); tests/toast-module-instance.test.ts guards
  // that, and this call is deliberately inside the function so it runs in the
  // browser rather than at module scope.
  try {
    useToast().error(message, { duration: 8000 })
  } catch {
    // A toast host may not be mounted yet (an auth call during the very first
    // render). The console keeps the gap visible rather than losing it.
    console.warn(message)
  }
}

export const authClient = createAuthClient({
  baseURL: authBaseURL(),
  plugins: [organizationClient(), magicLinkClient()],
  fetchOptions: {
    onError: (context) => reportDevAuthGap(context.error),
  },
})

export const {
  useSession,
  signIn,
  signUp,
  signOut,
  organization,
  changeEmail,
  changePassword,
  deleteUser,
  updateUser,
  requestPasswordReset,
  resetPassword,
} = authClient
