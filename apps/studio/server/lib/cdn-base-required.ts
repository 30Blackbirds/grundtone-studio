// In production, an unset CDN host is a refusal to start (KH-1178).
//
// 🔴 WHY A REFUSAL AND NOT A DEFAULT. utils/cdn-base.ts falls back to the
// request origin. That is right in dev and in a self-hosted install, and WRONG
// in our production, where the SDK is served from a separate CDN host that
// customers pin an SRI hash against. A default that is wrong in production is
// the worst kind: it produces a running app that hands customers the wrong host
// and looks healthy doing it.
//
// So the fallback is made UNREACHABLE in production rather than made clever.
// A value that cannot occur in normal operation is a value that cannot diverge
// in normal operation — and if it ever does occur, the process says so loudly
// instead of serving a plausible wrong answer.
//
// 🔴 WHAT IS GATED IS THE PRODUCED VALUE, NOT THE ENVIRONMENT VARIABLE. It
// reads the same `runtimeConfig.public.cdnBase` that is serialised into every
// page's payload and that both install screens consume. Asserting on
// `process.env.NUXT_PUBLIC_CDN_BASE` would pass while the value the customer
// actually receives came from somewhere else.

export class CdnBaseMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CdnBaseMissingError'
  }
}

/**
 * @param cdnBase the value from `runtimeConfig.public.cdnBase`
 * @param nodeEnv `process.env.NODE_ENV`
 * @throws CdnBaseMissingError in production when the host is empty
 */
export function assertCdnBaseConfigured(
  cdnBase: string | undefined,
  nodeEnv: string | undefined,
): void {
  if (nodeEnv !== 'production') return
  if (cdnBase?.trim()) return

  throw new CdnBaseMissingError(
    'refusing to start: NUXT_PUBLIC_CDN_BASE is empty in production. Both install screens ' +
      'would fall back to the request origin and announce a host customers must not pin ' +
      'against. Set it to the CDN host that serves /client/… and /k/… (KH-1178).',
  )
}
