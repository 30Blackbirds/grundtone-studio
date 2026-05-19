import * as Sentry from '@sentry/nuxt'

// Nitro-side Sentry init. Mirrors the client config so a single trace can
// span browser click → Nitro handler → DB query via the propagated trace
// header. process.env over useRuntimeConfig because Nitro starts before
// Nuxt's runtime config is fully resolved.

const env = (process.env.NODE_ENV ?? 'development') as 'development' | 'production'

Sentry.init({
  dsn: process.env.NUXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NUXT_PUBLIC_SENTRY_ENVIRONMENT ?? env,
  enabled: Boolean(process.env.NUXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: env === 'production' ? 0.1 : 1.0,
})
