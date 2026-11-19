// The fixture's own Nuxt config: locale files (merged into Studio's) and one
// scheduled task (merged into Studio's scheduledTasks).
export default defineNuxtConfig({
  i18n: {
    locales: [
      { code: 'da', file: 'da.json' },
      { code: 'en', file: 'en.json' },
    ],
  },
  nitro: {
    scheduledTasks: {
      '0 0 1 1 *': ['contract:ping'],
    },
  },
})
