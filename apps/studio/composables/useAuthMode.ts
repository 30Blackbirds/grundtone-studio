import type { AuthMode } from '~~/lib/account-identity'

/** The deployment's sign-in mode, from the public /api/features (shared key, fetched once). Reactive: it flips when the answer arrives. */
export function useAuthMode() {
  const { data } = useFetch<{ authMode?: AuthMode }>('/api/features', { key: 'features' })
  return computed<AuthMode>(() => data.value?.authMode ?? 'better-auth')
}
