// Workspace-root ESLint config — Nuxt app has its own config in apps/studio/
// that extends Nuxt's generated config. The saas-client package is built via
// vite + tsc (typecheck script) and uses its own tsconfig — we don't run
// the root ESLint over it because the root has no TypeScript parser configured.

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/dist/**',
      '**/.nitro/**',
      'apps/studio/**',
      'packages/**',
    ],
  },
]
