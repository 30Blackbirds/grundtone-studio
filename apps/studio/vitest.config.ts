import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
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
