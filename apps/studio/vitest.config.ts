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
      'pages/**/*.test.ts',
      'plugins/**/*.test.ts',
      'utils/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    coverage: {
      // 🔴 `lcov` er IKKE med i @vitest/coverage-v8's standard-reportere
      // (text, html, clover, json). Uden den findes ingen lcov.info, og
      // SonarQube melder 0% — hvilket laeses som en regression frem for som
      // en manglende fil.
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // `include` var afgraenset til server/lib. Det er en aerlig afgraensning
      // for en LOKAL koersel, men Sonar laeser tallet som repoets daekning —
      // og en daekningsgrad maalt paa en udvalgt tiendedel er et forkert tal,
      // ikke et delvist. Hele den kode vi selv skriver taeller nu med.
      include: ['server/**/*.ts', 'lib/**/*.ts', 'composables/**/*.ts', 'utils/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/migrations/**', '**/.nuxt/**'],
    },
  },
  resolve: {
    alias: {
      '~~': resolve(__dirname),
      '~': resolve(__dirname),
    },
  },
})
