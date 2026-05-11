import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Maps dev CDN-style URLs to the local saas-client build output. In production
// these files are uploaded to Bunny.net during release; here we serve them
// directly from the workspace package so install snippets work end-to-end.
const __dirname = dirname(fileURLToPath(import.meta.url))
const SDK_DIR = resolve(__dirname, '../../../../../packages/saas-client/dist')

const FILE_MAP: Record<string, { source: string; contentType: string }> = {
  'v1.js': { source: 'index.umd.js', contentType: 'application/javascript' },
  'v1.mjs': { source: 'index.mjs', contentType: 'application/javascript' },
  'v1.js.map': { source: 'index.umd.js.map', contentType: 'application/json' },
  'v1.mjs.map': { source: 'index.mjs.map', contentType: 'application/json' },
}

export default defineEventHandler(async (event) => {
  const file = getRouterParam(event, 'file')
  const mapping = file ? FILE_MAP[file] : undefined
  if (!mapping) throw createError({ statusCode: 404 })

  try {
    const body = await readFile(resolve(SDK_DIR, mapping.source), 'utf-8')
    setHeader(event, 'Content-Type', mapping.contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=300')
    setHeader(event, 'Access-Control-Allow-Origin', '*')
    return body
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: 'SDK bundle not built — run `pnpm --filter @grundtone/saas-client build`',
    })
  }
})
