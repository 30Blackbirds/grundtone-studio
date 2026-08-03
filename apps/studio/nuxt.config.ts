import { createRequire } from 'node:module'

// traceInclude tager FIL-stier, ikke pakkenavne — resolve til entry-filerne
// (byggefejl "File …/@opentelemetry/sdk-metrics does not exist" ellers).
const _require = createRequire(import.meta.url)

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-04-21',
  devtools: { enabled: true },
  // The authenticated app section is client-rendered. It has no SEO value behind
  // login, and direct/SSR loads of pages whose composables run after their data
  // awaits (e.g. the project token editor → useProjectRole/useAsyncData) fail
  // with "[nuxt] instance unavailable". Client rendering sidesteps that class;
  // /api/* stays protected by the Nitro auth middleware regardless.
  routeRules: {
    '/orgs/**': { ssr: false },
    '/account': { ssr: false },
  },
  nitro: {
    // v0.2.11-incident: Nitros externals-tracing missede transitive CJS-deps i
    // OTel-exporter-kæden (exporter-metrics-otlp-proto → -otlp-http → …) —
    // imaget bootede med MODULE_NOT_FOUND. traceInclude tvinger hele grafen
    // med i .output/server/node_modules. Plugin'en er derudover fail-soft
    // (dynamiske imports + try/catch), så en regression her koster telemetri,
    // aldrig boot. CI's boot-smoke (build.yml) er den strukturelle gate.
    externals: {
      traceInclude: [
        _require.resolve('@opentelemetry/exporter-metrics-otlp-proto'),
        _require.resolve('@opentelemetry/sdk-metrics'),
      ],
    },
    // Auto-genereret OpenAPI-spec (dev-only DX på /_openapi.json + doc-UI'er).
    experimental: { openAPI: true },
    // Jura-fund 2026-08-03 (consent-spec §1a) + CTO-ruling: /_swagger +
    // /_scalar var OFFENTLIGE i prod (loadede cdn.jsdelivr.net = consent-
    // brud) og /_openapi.json udstillede 36 interne API-stier. api.klanghaus.
    // dk/docs-aggregeringen er STATISKE filer (infra-verificeret file_server,
    // IKKE live-fetch af denne rute) — så runtime-serving slås HELT fra:
    // ingen production-nøgle = spec + UI'er findes kun i dev (lokal DX).
    // Build-time spec-artefakt til docs-pipelinen er et separat [docs]-spor.
  },
  modules: ['@nuxt/eslint', '@grundtone/nuxt', '@nuxtjs/i18n', '@sentry/nuxt/module'],
  css: ['@grundtone/design-system/css', '~/assets/css/app.css'],
  i18n: {
    defaultLocale: 'da',
    strategy: 'no_prefix',
    locales: [
      { code: 'da', name: 'Dansk', file: 'da.json' },
      { code: 'en', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      redirectOn: 'root',
    },
  },
  typescript: {
    strict: true,
    typeCheck: false,
    // Skip vue-tsc on grundtone-vue's source files — its package ships `.vue`
    // sources alongside `dist`, which tsc tries to type-check and currently
    // has a few upstream issues (tracked separately). We trust the dist types.
    tsConfig: {
      exclude: ['../../node_modules/.pnpm/@grundtone+vue*/**'],
    },
  },
  runtimeConfig: {
    databaseUrl: '',
    // Central auth + PDP server-side endpoints are read from bare process.env
    // (AUTH_ISSUER, AUTH_AUDIENCE, PERMISSIONS_URL) in server/middleware/auth.ts,
    // server/lib/pdp.ts and server/lib/org-lookup.ts — kept off runtimeConfig so
    // the env contract matches what [auth]/[infra] provision verbatim.
    s3Endpoint: '',
    s3Region: '',
    s3Bucket: '',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    public: {
      appUrl: '',
      cdnBase: '',
      // Browser-facing base URL of the central auth service. The Better Auth
      // client (lib/auth-client.ts) points its baseURL here for sign-in,
      // session, magic-link, and organization endpoints.
      authUrl: '',
      sentryDsn: '',
      sentryEnvironment: '',
    },
  },
  // 'hidden': generate client sourcemaps for the Sentry upload WITHOUT
  // referencing them from the served bundles (no public sourceMappingURL).
  // Without this the upload step has nothing to upload — the build warned
  // "Source map generation (sourcemap.client) is disabled".
  sourcemap: { client: 'hidden' },
  sentry: {
    // Source-map upload runs during `nuxt build` when SENTRY_AUTH_TOKEN is in
    // the env (repo secret → BuildKit secret in the image build; absent
    // locally/CI-PR builds, where upload silently skips). Org token minted by
    // Allan 2026-07-29 (issue #123).
    sourceMapsUploadOptions: {
      org: 'klanghaus',
      project: 'grundtone-studio',
      sourcemaps: {
        // The maps exist ONLY for Sentry — never ship them in the image where
        // they'd be publicly fetchable (source disclosure for a private SaaS).
        filesToDeleteAfterUpload: ['.output/**/*.map'],
      },
    },
  },
})
