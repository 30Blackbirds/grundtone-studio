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
    include: [
      'server/**/*.test.ts',
      'lib/**/*.test.ts',
      'composables/**/*.test.ts',
      'components/**/*.test.ts',
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
