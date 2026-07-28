// Root config (moved out of package.json). Files under apps/studio/ are
// handled by apps/studio/lint-staged.config.mjs instead — lint-staged matches
// each staged file to its CLOSEST config and runs the task from that config's
// directory. That matters for ESLint: the studio app has its own Nuxt-aware
// eslint.config.mjs, and linting studio files from the repo root applies the
// wrong (non-Nuxt) config → phantom no-undef/no-unused-vars errors in files
// like pages/orgs/[slug]/members/[memberId].vue.
export default {
  '*.{ts,tsx,vue,css,json,md,yml,yaml}': ['prettier --write'],
  '*.{ts,tsx,vue}': ['eslint --fix'],
  '*.css': ['stylelint --fix'],
}
