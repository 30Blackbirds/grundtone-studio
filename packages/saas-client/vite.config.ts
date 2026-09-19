import { defineConfig, type Plugin } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

/**
 * Emit a SHA-384 hash file next to every output bundle, so consumers can
 * pin the script-tag with a Sub-Resource Integrity attribute.
 *
 *   <script src="cdn.grundtone.com/client/v1.0.0.js"
 *           integrity="sha384-<hash from v1.0.0.js.sri>"
 *           crossorigin="anonymous"></script>
 *
 * The studio image serves both the bundle and its .sri file from the same
 * dist (apps/studio/server/routes/client), so the CDN serves matching pairs.
 */
function sriHashes(): Plugin {
  return {
    name: 'sri-hashes',
    apply: 'build',
    closeBundle() {
      const dist = resolve(__dirname, 'dist')
      for (const file of readdirSync(dist)) {
        if (!/\.(js|mjs)$/.test(file)) continue
        const body = readFileSync(resolve(dist, file))
        const hash = createHash('sha384').update(body).digest('base64')
        writeFileSync(resolve(dist, `${file}.sri`), `sha384-${hash}\n`)
      }
    },
  }
}

export default defineConfig({
  plugins: [dts({ rollupTypes: true }), sriHashes()],
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
