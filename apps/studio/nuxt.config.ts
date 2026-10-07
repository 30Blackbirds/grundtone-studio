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
    // 🔴 A SERVER REDIRECT, BECAUSE THE CLIENT ONE PRODUCED A HYDRATION
    // MISMATCH (KH-1034, found by [designer] on the root path). `pages/index.vue`
    // called `navigateTo('/dashboard')` inside `onMounted` — client-only by
    // construction — so the server rendered `<p>Loading…</p>`, the client
    // hydrated it and immediately navigated somewhere else. Two different trees
    // at the same position is the definition of the mismatch.
    // Measured on the served build before the change: `/` returned 200 and the
    // server HTML contained "Loading" once. A 302 renders nothing at all, so
    // there is no tree to disagree about — the class of defect is removed
    // rather than the symptom.
    // NOTE: `pages/index.vue` is deleted with this rule. Remove the rule and `/`
    // becomes a 404, not a loading screen.
    '/': { redirect: '/dashboard' },
    '/orgs/**': { ssr: false },
    '/account': { ssr: false },
  },
  // 🔴 DEV ONLY: point Nitro at the resolved entry file of
  // @opentelemetry/resources (KH-1184).
  //
  // THE SYMPTOM: `nuxt dev` started, printed its Local URL, built the Vite
  // client and server — and then died with
  //   ENOTDIR: not a directory, stat '…/@opentelemetry/resources/build/src/index.js/build/src/index.js/build/src/index.js/build/src'
  // The port stayed OPEN and every request hung (curl 000 on healthz and on
  // every page), so nobody could run studio locally — including [designer],
  // who judges pages at 1440 and 375, and for whom the dev-auth bypass
  // (#294/#295) exists.
  //
  // THE MECHANISM the path names: `main` applied to a path that ALREADY ends in
  // `main`, again and again. @opentelemetry/resources declares `main:
  // build/src/index.js` and has NO `exports` map, so the dev resolver walks the
  // legacy field and re-enters. Aliasing to the resolved file removes the walk.
  //
  // MEASURED, A/B with a startup control on both sides (a 000 means nothing
  // unless the server actually started):
  //   telemetry plugin off → started, no ENOTDIR, healthz 200
  //   telemetry plugin on  → started, ENOTDIR,    healthz 000
  // so the trigger is this plugin's dynamic import of that one package. Two
  // cures were tried and MEASURED NOT TO WORK before this one:
  // removing `externals.traceInclude`, and `externals.inline` of the OTel
  // chain. Clearing .nuxt/.nitro/vite caches did not help either.
  //
  // WHY $development: the production build must not move. The OTel chain has
  // broken the image before (v0.2.11, 2026-08-03: Nitro's externals tracing
  // dropped transitive CJS deps and the image crashlooped), and `traceInclude`
  // below is the cure for THAT. This alias changes dev resolution only; the
  // image is still built and boot-smoked by build.yml exactly as before.
  $development: {
    nitro: {
      alias: {
        '@opentelemetry/resources': _require.resolve('@opentelemetry/resources'),
      },
    },
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
  // Favicon/apple-touch fra det officielle grundtone-maerke (grundtone#140),
  // SELV-HOSTET fra public/ som /brand/logo-32x32.png — aldrig jsDelivr (jura-
  // consent). Uden disse serverede Nuxt sin 1x1-GIF-fallback paa /favicon.ico
  // (maalt i prod 2026-08-19: 200, image/x-icon, 78 bytes, tom). Samme frys-
  // regel som i layouts/app.vue: nyt maerke i core = kopier filerne igen.
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
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
    //
    // 🔴 FLATTENED FOR @sentry/nuxt v11, which REMOVED
    // `sourceMapsUploadOptions`. Measured in the installed v11 types rather
    // than guessed: `SentryNuxtModuleOptions = BuildTimeOptionsBase & {…}`
    // (common/types.d.ts:22), and `BuildTimeOptionsBase` carries `org`,
    // `project` and `sourcemaps` at the TOP level
    // (build-time-plugins/buildTimeOptionsBase.d.ts:28, 34, 101) with
    // `filesToDeleteAfterUpload` inside `SourceMapsOptions` (l.221). The
    // nesting moved; no option was renamed or dropped.
    org: 'klanghaus',
    project: 'grundtone-studio',
    sourcemaps: {
      // The maps exist ONLY for Sentry, and must never ship in the image where
      // they'd be publicly fetchable (source disclosure for a private SaaS).
      //
      // 🔴 THIS IS NOT WHAT PROTECTS THE IMAGE, and the previous wording read
      // as if it were. Measured: a token-less build leaves ZERO .map files in
      // .output and 122 in .nuxt, and the image is guarded twice without this
      // option — Dockerfile l.51 runs `find apps/studio/.output -name '*.map'
      // -delete`, and .dockerignore l.8 excludes `**/.nuxt` so those 122 never
      // enter the build context. So removing this line would not leak maps;
      // it only keeps Sentry's own upload from leaving them behind.
      filesToDeleteAfterUpload: ['.output/**/*.map'],
    },
  },
})
