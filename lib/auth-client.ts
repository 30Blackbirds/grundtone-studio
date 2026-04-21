import { createAuthClient } from 'better-auth/vue'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
  plugins: [organizationClient(), magicLinkClient()],
})

export const { useSession, signIn, signUp, signOut, organization } = authClient
