import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { SDK_CONTRACT_MAJOR } from '~~/utils/sdk-contract'

// Serves the browser SDK at CDN-style URLs. This is the SDK's production
// origin: the Bunny pull zone in front of cdn.grundtone.com uses studio as its
// origin (KH-988).
//
// TWO SOURCES, and the split is the point (KH-991):
//   v<major>.*   the LATEST build, from the saas-client dist the image copies.
//                Short cache: a deploy must be picked up soon.
//   v<x.y.z>.*   a PUBLISHED contract version, from the files committed under
//                apps/studio/sdk-contract/. Immutable cache, because customers
//                pin these with SRI.
// Before KH-991 the versioned URL was served from the dist too, so it only ever
// existed for the CURRENT contract: bumping to 1.0.1 would have turned
// /client/v1.0.0.js into a 404, and every SRI pin on it would break the day the
// CDN copy expired. Committed files make every version that was ever published
// keep answering, byte for byte.
//
// import.meta.url is unreliable in Nitro (handlers get bundled into a transient
// .nitro location), so paths resolve from process.cwd(), mirroring
// /api/changelog/[source]. Nuxt dev runs from apps/studio/; the image runs from
// /app, where the Dockerfile puts both the dist and the contract directory.
const DIST = 'packages/saas-client/dist'
const SDK_DIRS = [resolve(process.cwd(), '../..', DIST), resolve(process.cwd(), DIST)]
const CONTRACT_DIR = resolve(process.cwd(), 'sdk-contract')

const LATEST_CACHE = 'public, max-age=300'
const VERSIONED_CACHE = 'public, max-age=31536000, immutable'

const CONTENT_TYPES: Record<string, string> = {
  js: 'application/javascript',
  mjs: 'application/javascript',
  'js.map': 'application/json',
  'mjs.map': 'application/json',
  'js.sri': 'text/plain',
  'mjs.sri': 'text/plain',
}

const LATEST_SOURCES: Record<string, string> = {
  js: 'index.umd.js',
  mjs: 'index.mjs',
  'js.map': 'index.umd.js.map',
  'mjs.map': 'index.mjs.map',
  'js.sri': 'index.umd.js.sri',
  'mjs.sri': 'index.mjs.sri',
}

// A committed contract file: v<x.y.z>.<ext>, and nothing else. The request
// parameter never becomes a filesystem path — it is only ever a KEY into the set
// of names read from the directory, exactly as the old static map was.
const CONTRACT_FILE = /^v\d+\.\d+\.\d+\.(js|mjs|js\.map|mjs\.map|js\.sri|mjs\.sri)$/

let contractFiles: Promise<Set<string>> | null = null
function committedContractFiles(): Promise<Set<string>> {
  contractFiles ??= readdir(CONTRACT_DIR)
    .then((names) => new Set(names.filter((n) => CONTRACT_FILE.test(n))))
    // A missing directory serves no versioned URL at all rather than failing
    // open: an empty set 404s every v<x.y.z> request.
    .catch(() => new Set<string>())
  return contractFiles
}

defineRouteMeta({
  openAPI: {
    summary: 'Serves the browser SDK bundles (v1.js/.mjs/.map/.sri) that the CDN pulls from.',
    description:
      'Origin for cdn.grundtone.com/client: v1.* is the latest build with a short cache; v<x.y.z>.* is every published contract version, served immutably from committed files so SRI pins keep working after a bump.',
    tags: ['CDN'],
  },
})

export default defineEventHandler(async (event) => {
  const file = getRouterParam(event, 'file') ?? ''

  // Latest build of the major line.
  const latestPrefix = `v${SDK_CONTRACT_MAJOR}.`
  const latestExt = file.startsWith(latestPrefix) ? file.slice(latestPrefix.length) : undefined
  if (latestExt && LATEST_SOURCES[latestExt]) {
    for (const dir of SDK_DIRS) {
      let body: string
      try {
        body = await readFile(resolve(dir, LATEST_SOURCES[latestExt]), 'utf-8')
      } catch {
        continue
      }
      setHeader(event, 'Content-Type', CONTENT_TYPES[latestExt]!)
      setHeader(event, 'Cache-Control', LATEST_CACHE)
      setHeader(event, 'Access-Control-Allow-Origin', '*')
      return body
    }
    throw createError({
      statusCode: 404,
      statusMessage: 'SDK bundle not built — run `pnpm --filter @grundtone/saas-client build`',
    })
  }

  // A published contract version, from the committed files.
  if ((await committedContractFiles()).has(file)) {
    // The extension comes from the SAME pattern that admitted the name, so the
    // content type can never disagree with what was allowed through.
    const ext = CONTRACT_FILE.exec(file)![1]!
    const body = await readFile(resolve(CONTRACT_DIR, file), 'utf-8')
    setHeader(event, 'Content-Type', CONTENT_TYPES[ext]!)
    setHeader(event, 'Cache-Control', VERSIONED_CACHE)
    setHeader(event, 'Access-Control-Allow-Origin', '*')
    return body
  }

  throw createError({ statusCode: 404 })
})
