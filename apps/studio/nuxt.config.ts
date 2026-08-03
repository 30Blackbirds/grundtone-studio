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
    // Auto-genereret OpenAPI-spec over studios server/api/*-endpoints. Serveres
    // på /_openapi.json og aggregeres i KlangHaus' samlede API-docs-portal
    // (api.klanghaus.dk/docs / lokal localhost:8000/docs). `production: 'runtime'`
    // kræves for at specet også serveres i den byggede .output (experimental-
    // flaget alene er dev-only).
    experimental: { openAPI: true },
    // Jura-fund 2026-08-03 (consent-spec §1a): /_swagger + /_scalar var
    // OFFENTLIGE i prod og loadede cdn.jsdelivr.net (tredjeparts-load =
    // consent-brud) — og /_openapi.json udstillede 36 interne API-stier
    // (angrebsflade-beskrivelse). UI'erne er slået HELT fra (framework-
    // default, ingen har brug for dem på Studios domæne — API-docs bor på
    // api.klanghaus.dk); spec-ruten består til aggregatoren men gates af
    // server/middleware/openapi-guard.ts (token, fail-closed i prod).
    openAPI: {
      production: 'runtime',
      ui: { scalar: false, swagger: false },
    },
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
