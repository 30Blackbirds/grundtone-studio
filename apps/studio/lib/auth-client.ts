import { createAuthClient } from 'better-auth/vue'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'

// Studio consumes the CENTRAL auth service. baseURL points at it (runtime
// PUBLIC_AUTH_URL) so sign-in / session / magic-link / organization endpoints
// all resolve against the shared auth deployment rather than studio's own
// origin. Studio no longer runs Better Auth server-side.
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
