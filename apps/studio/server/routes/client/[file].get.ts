import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { SDK_CONTRACT_MAJOR, SDK_CONTRACT_VERSION } from '~~/utils/sdk-contract'

// Serves the saas-client build output at CDN-style URLs. This is the SDK's
// production origin: the Bunny pull zone in front of cdn.grundtone.com uses
// studio as its origin, and the Dockerfile copies the dist into the image
// (KH-988).
//
// import.meta.url is unreliable in Nitro (handlers get bundled into a transient
// .nitro location), so we resolve from process.cwd(), mirroring
// /api/changelog/[source]. Nuxt dev runs from apps/studio/, where the workspace
// package is two levels up; the image runs from /app, where the Dockerfile put
// the copy.
const DIST = 'packages/saas-client/dist'
const SDK_DIRS = [resolve(process.cwd(), '../..', DIST), resolve(process.cwd(), DIST)]

// v1.js follows the latest build, so caches must pick up a new deploy soon.
// v1.0.0.js is pinned by customers with SRI and must never change under them.
const LATEST_CACHE = 'public, max-age=300'
const VERSIONED_CACHE = 'public, max-age=31536000, immutable'

const ASSETS = [
  { ext: 'js', source: 'index.umd.js', contentType: 'application/javascript' },
  { ext: 'mjs', source: 'index.mjs', contentType: 'application/javascript' },
  { ext: 'js.map', source: 'index.umd.js.map', contentType: 'application/json' },
  { ext: 'mjs.map', source: 'index.mjs.map', contentType: 'application/json' },
  { ext: 'js.sri', source: 'index.umd.js.sri', contentType: 'text/plain' },
  { ext: 'mjs.sri', source: 'index.mjs.sri', contentType: 'text/plain' },
]

const FILE_MAP = new Map(
  ASSETS.flatMap(({ ext, source, contentType }) => [
    [`v${SDK_CONTRACT_MAJOR}.${ext}`, { source, contentType, cacheControl: LATEST_CACHE }],
    [`v${SDK_CONTRACT_VERSION}.${ext}`, { source, contentType, cacheControl: VERSIONED_CACHE }],
  ]),
)

defineRouteMeta({
  openAPI: {
    summary: 'Serves the browser SDK bundles (v1.js/.mjs/.map/.sri) that the CDN pulls from.',
    description:
      'Origin for cdn.grundtone.com/client: v1.* is the latest build with a short cache, v1.0.0.* is the pinned contract version with an immutable cache for SRI.',
    tags: ['CDN'],
  },
})

export default defineEventHandler(async (event) => {
  const file = getRouterParam(event, 'file')
  const mapping = file ? FILE_MAP.get(file) : undefined
  if (!mapping) throw createError({ statusCode: 404 })

  for (const dir of SDK_DIRS) {
    let body: string
    try {
      body = await readFile(resolve(dir, mapping.source), 'utf-8')
    } catch {
      continue
    }
    setHeader(event, 'Content-Type', mapping.contentType)
    setHeader(event, 'Cache-Control', mapping.cacheControl)
    setHeader(event, 'Access-Control-Allow-Origin', '*')
    return body
  }
  throw createError({
    statusCode: 404,
    statusMessage: 'SDK bundle not built — run `pnpm --filter @grundtone/saas-client build`',
  })
})
