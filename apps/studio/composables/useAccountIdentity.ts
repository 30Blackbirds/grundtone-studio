import { useSession } from '~~/lib/auth-client'
import { resolveAccountIdentity, type AuthMode } from '~~/lib/account-identity'

/**
 * The signed-in person as the account pages show them. Which source answers
 * (Better Auth session or Studio's own OIDC session) is the deployment's
 * AUTH_MODE, read from the public /api/features.
 */
export function useAccountIdentity() {
  const features = useFetch<{ authMode?: AuthMode }>('/api/features', { key: 'features' })
  const betterAuth = useSession()
  const mode = computed<AuthMode>(() => features.data.value?.authMode ?? 'better-auth')
  const oidc = useFetch<{ user: { email: string | null; emailVerified: boolean } | null }>(
    '/api/oidc/session',
    { key: 'oidc-session', immediate: false },
  )
  watch(
    mode,
    (m) => {
      if (m === 'oidc') void oidc.execute()
    },
    { immediate: true },
  )
  return computed(() =>
    resolveAccountIdentity({
      mode: mode.value,
      betterAuth: {
        pending: betterAuth.value.isPending,
        user: betterAuth.value.data?.user,
      },
      oidc: { loaded: oidc.status.value === 'success', user: oidc.data.value?.user },
    }),
  )
}
