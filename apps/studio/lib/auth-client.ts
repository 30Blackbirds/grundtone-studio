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

export const authClient = createAuthClient({
  baseURL: authBaseURL(),
  plugins: [organizationClient(), magicLinkClient()],
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
