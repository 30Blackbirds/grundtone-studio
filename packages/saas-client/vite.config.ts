import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GrundtoneSaasClient',
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.umd.js'),
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: ['@grundtone/core'],
      output: {
        globals: { '@grundtone/core': 'GrundtoneCore' },
      },
    },
  },
})
