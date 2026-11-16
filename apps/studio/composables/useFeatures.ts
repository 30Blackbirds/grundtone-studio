// The deployment's optional features (server/api/features.get.ts). Cached under
// one key, so the sidebar and the billing page share a single request.

interface Features {
  billing: boolean
}

export const useFeatures = () => {
  const { data } = useAsyncData<Features>(
    'features',
    () => ($fetch as (url: string) => Promise<Features>)('/api/features'),
    // Until the answer arrives, or if it fails, show no billing link: the
    // server enforces the flag either way, so hiding is the cheap error.
    { default: () => ({ billing: false }) },
  )
  return { billingEnabled: computed(() => data.value.billing) }
}
