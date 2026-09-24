// The CDN host has ONE source (KH-1178), in the same form as the SDK version
// has one (KH-857 b, utils/sdk-contract.ts).
//
// 🔴 WHY. The guide (`pages/docs/install.vue`) fell back to a hardcoded
// `https://cdn.grundtone.com`, while the in-app snippet
// (`components/InstallSnippet.vue`) fell back to `window.location.origin`, and
// `nuxt.config` ships `cdnBase: ''`. With NUXT_PUBLIC_CDN_BASE unset, the two
// screens announce TWO DIFFERENT HOSTS to the same customer — and the customer
// pins an SRI hash against whichever one they happened to read.
//
// "One source" for the version did not make the HOST one source. This does.
//
// 🔴 AND WHY THE FALLBACK IS THE REQUEST ORIGIN, NOT THE PRODUCTION HOST. A
// literal production host as a fallback is a value that is RIGHT in production
// and silently wrong everywhere else — the failure it produces (a dev machine
// telling you to load from prod) reads as working. The request origin is right
// in dev, right in a self-hosted install, and never reached in production,
// because an empty cdnBase is refused at boot there
// (server/plugins/assert-cdn-base.ts). A fallback that cannot be reached in
// normal operation is one that cannot diverge in normal operation.

/**
 * @param configured `runtimeConfig.public.cdnBase` — '' when unset.
 * @param origin the origin serving this page (`useRequestURL().origin`), which
 *   also serves `/k/…` and `/client/…` in dev and in a self-hosted install.
 */
export function resolveCdnBase(configured: string | undefined, origin: string): string {
  const trimmed = configured?.trim().replace(/\/+$/, '')
  return trimmed ? trimmed : origin.replace(/\/+$/, '')
}
