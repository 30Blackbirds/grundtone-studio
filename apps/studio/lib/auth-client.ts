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
  // useRuntimeConfig is auto-imported in Nuxt; available on both server and
  // client. public.authUrl is fed by NUXT_PUBLIC_AUTH_URL.
  const url = useRuntimeConfig().public.authUrl
  return url || undefined
}

export const authClient = createAuthClient({
  baseURL: authBaseURL(),
  plugins: [organizationClient(), magicLinkClient()],
})

export const { useSession, signIn, signUp, signOut, organization } = authClient
