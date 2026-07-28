import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  // Required so vitest can compile .vue SFCs in component tests. Server
  // tests don't touch .vue files, so the plugin is a no-op for them.
  plugins: [vue()],
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup-vue.ts'],
    server: {
      deps: {
        // Components import runtime pieces from @grundtone/vue (e.g. useToast),
        // whose package index side-effect-imports base.css. Inlining routes the
        // package through Vite's transform (CSS → no-op) instead of Node's ESM
        // loader, which rejects the .css extension.
        inline: ['@grundtone/vue'],
      },
    },
    include: [
      'server/**/*.test.ts',
      'lib/**/*.test.ts',
      'composables/**/*.test.ts',
      'components/**/*.test.ts',
      'middleware/**/*.test.ts',
      'utils/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    coverage: {
      reporter: ['text', 'html'],
      include: ['server/lib/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '~~': resolve(__dirname),
      '~': resolve(__dirname),
    },
  },
})
