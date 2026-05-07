// Workspace-root ESLint config — Nuxt app has its own config in apps/studio/
// that extends Nuxt's generated config. This root config covers
// packages/ and any non-Nuxt code at the workspace root.

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/dist/**',
      '**/.nitro/**',
      'apps/studio/**',
    ],
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]
