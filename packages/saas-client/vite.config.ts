import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  define: {
    // Auto-init from <script data-api-key="..."> only fires when document.currentScript
    // is non-null AND this flag is true. ESM bundlers skip auto-init because
    // currentScript is null in module scope — this flag is a belt-and-suspenders.
    __SAAS_CLIENT_AUTO_INIT__: 'true',
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GrundtoneSaasClient',
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.umd.js'),
      formats: ['es', 'umd'],
    },
    // Inline @grundtone/core into the bundle so the script-tag UMD path is
    // fully standalone. ESM consumers will tree-shake what they don't use.
    rollupOptions: {
      external: [],
    },
    sourcemap: true,
  },
})
