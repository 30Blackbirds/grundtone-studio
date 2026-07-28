// Studio-scoped lint-staged config: staged files under apps/studio match this
// (closest) config, and tasks run from THIS directory — so ESLint resolves the
// app's own Nuxt-aware eslint.config.mjs instead of the repo-root config,
// which misparses Nuxt files (e.g. dynamic-route pages using DOM lib types).
export default {
  '*.{ts,tsx,vue,css,json,md,yml,yaml}': ['prettier --write'],
  '*.{ts,tsx,vue}': ['eslint --fix'],
  '*.css': ['stylelint --fix'],
}
