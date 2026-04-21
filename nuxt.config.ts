// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-04-21',
  devtools: { enabled: true },
  css: ['~/assets/css/app.css'],
  typescript: {
    strict: true,
    typeCheck: false,
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
    },
  },
})
