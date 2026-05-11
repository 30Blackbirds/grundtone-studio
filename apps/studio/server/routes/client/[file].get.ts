import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Maps dev CDN-style URLs to the local saas-client build output. In production
// these files are uploaded to Bunny.net during release; here we serve them
// directly from the workspace package so install snippets work end-to-end.
//
// import.meta.url is unreliable in Nitro dev (handlers get bundled into a
// transient .nitro location), so we resolve from process.cwd(). Nuxt dev
// runs from apps/studio/, so ../../packages/saas-client/dist hits the right
// workspace package.
const CWD_RELATIVE = '../../packages/saas-client/dist'
const SDK_DIR = resolve(process.cwd(), CWD_RELATIVE)

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
