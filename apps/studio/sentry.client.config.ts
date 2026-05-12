import * as Sentry from '@sentry/nuxt'

// Browser-side Sentry init. Reads from public runtime config so deploys can
// override per environment without rebuilding. tracesSampleRate is 100% in
// dev/staging (low traffic — full visibility) and 10% in production to keep
// the free tier humane.

const config = useRuntimeConfig()
const env = (process.env.NODE_ENV ?? 'development') as 'development' | 'production'

Sentry.init({
  dsn: config.public.sentryDsn,
  environment: config.public.sentryEnvironment,
  enabled: Boolean(config.public.sentryDsn),
  tracesSampleRate: env === 'production' ? 0.1 : 1.0,
  // Replay + profiling intentionally off — turn on once we have a customer
  // who needs the session-level debugging and we've reviewed the GDPR
  // implications of capturing DOM state.
  integrations: [],
})
