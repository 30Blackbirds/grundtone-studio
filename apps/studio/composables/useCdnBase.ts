import { resolveCdnBase } from '~~/utils/cdn-base'

/**
 * The CDN host, for every screen that shows a customer where to load from.
 *
 * 🔴 THIS IS THE ONLY PLACE `public.cdnBase` IS READ (KH-1178). The guard in
 * scripts/sdk-url-guard.mjs fails the build if another file reads it, because
 * the failure being prevented is precisely two readers with two different
 * fallbacks: the guide said `https://cdn.grundtone.com`, the in-app snippet
 * said `window.location.origin`, and with the variable unset they announced two
 * different hosts to the same customer.
 *
 * `useRequestURL()` rather than `window.location`: the guide renders on the
 * server, where `window` does not exist.
 */
export function useCdnBase() {
  const configured = useRuntimeConfig().public.cdnBase
  const origin = useRequestURL().origin
  return computed(() => resolveCdnBase(configured, origin))
}
