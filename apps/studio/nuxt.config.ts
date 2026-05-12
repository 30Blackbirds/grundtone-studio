// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-04-21',
  devtools: { enabled: true },
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
    betterAuthSecret: '',
    s3Endpoint: '',
    s3Region: '',
    s3Bucket: '',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    public: {
      appUrl: '',
      cdnBase: '',
      sentryDsn: '',
      sentryEnvironment: '',
    },
  },
  sentry: {
    // Source maps upload requires SENTRY_AUTH_TOKEN in the build env.
    // Wire it into the GitHub Actions build job via the `release` environment
    // before Phase 6 launch.
    sourceMapsUploadOptions: {
      org: 'asp-productions-aps',
      project: 'grundtone-studio',
    },
  },
})
