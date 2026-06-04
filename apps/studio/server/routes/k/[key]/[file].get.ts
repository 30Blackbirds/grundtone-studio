import { createHash } from 'node:crypto'
import { eq, isNull, and } from 'drizzle-orm'
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  setHeader,
  setResponseStatus,
} from 'h3'
import { db } from '~~/server/db'
import { apiKey, project } from '~~/server/db/schema'
import { hashApiKey } from '~~/server/lib/api-keys'
import { paths, getObjectAsString } from '~~/server/lib/storage'
import { TTLCache } from '~~/server/lib/ttl-cache'
import { SlidingWindowRateLimiter } from '~~/server/lib/rate-limit'

const VALID_FILES = new Set(['tokens.json', 'tokens.css'])

// Plaintext API key in the URL is intentional — see docs/api/cdn-keys.md
// for the full rationale (Stripe pk_live model: publishable keys with no
// confidentiality value, scoped read-only access, hashed at rest).

// In-memory caches scoped to this process. The CDN endpoint is on the hot
// path — without these we'd round-trip the DB + S3 on every request.

// Maps SHA-256(plaintext key) → { projectId, allowedOrigins, rateLimit }.
// 30s TTL so revoked / rate-limit-bumped keys propagate quickly without
// requiring a manual purge. 5000 entries max — the api_key table is bounded
// in practice anyway.
interface KeyMeta {
  projectId: string
  allowedOrigins: string[]
  rateLimit: number
}
const keyCache = new TTLCache<string, KeyMeta>(5000, 30_000)

// Maps the S3 path → { body, etag }. 60s TTL matches the public Cache-Control
// we serve; any new publish overwrites the storage path so a stale cache entry
// only sticks around for one window.
interface BlobEntry {
  body: string
  etag: string
}
const blobCache = new TTLCache<string, BlobEntry>(5000, 60_000)

// Sliding window per key, sized to whatever rate_limit is configured per key
// (defaults to 1000/min in the schema). Window matches the typical "requests
// per minute" mental model.
const rateLimiter = new SlidingWindowRateLimiter(60_000, 10_000)

function buildEtag(body: string): string {
  return `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`
}

/**
 * Public CDN-style endpoint mirroring the production URL pattern
 *   cdn.grundtone.io/k/<pk_live_...>/tokens.json
 *
 * Pipeline:
 *   1. Resolve API key → project (in-memory cache, DB on miss)
 *   2. Enforce sliding-window rate limit per key (429 over the limit)
 *   3. Origin allowlist check (403 if mismatched)
 *   4. Fetch blob from storage (in-memory cache, S3 on miss)
 *   5. Compare If-None-Match → 304 if client already has the bytes
 *   6. Stream body with ETag + Cache-Control + permissive CORS
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')
  const file = getRouterParam(event, 'file')
  if (!key || !file) throw createError({ statusCode: 404 })
  if (!VALID_FILES.has(file)) throw createError({ statusCode: 404 })

  const hash = hashApiKey(key)

  let meta = keyCache.get(hash)
  if (!meta) {
    const [row] = await db
      .select({
        projectId: apiKey.projectId,
        allowedOrigins: apiKey.allowedOrigins,
        rateLimit: apiKey.rateLimit,
      })
      .from(apiKey)
      .innerJoin(project, eq(project.id, apiKey.projectId))
      .where(and(eq(apiKey.keyHash, hash), isNull(apiKey.revokedAt)))
    if (!row) throw createError({ statusCode: 401, statusMessage: 'Invalid API key' })
    meta = row
    keyCache.set(hash, row)
  }

  const limit = rateLimiter.check(hash, meta.rateLimit)
  if (!limit.ok) {
    setHeader(event, 'Retry-After', Math.ceil((limit.resetAt - Date.now()) / 1000))
    throw createError({ statusCode: 429, statusMessage: 'Rate limit exceeded' })
  }

  const origin = getRequestHeader(event, 'origin')
  if (meta.allowedOrigins.length > 0 && origin) {
    const allowed = meta.allowedOrigins.some((pattern) => matchOrigin(pattern, origin))
    if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Origin not allowed' })
  }

  const p = paths(meta.projectId)
  const blobKey = file === 'tokens.json' ? p.currentJson : p.currentCss

  let entry = blobCache.get(blobKey)
  if (!entry) {
    const body = await getObjectAsString(blobKey)
    if (!body) throw createError({ statusCode: 404, statusMessage: 'Not published yet' })
    entry = { body, etag: buildEtag(body) }
    blobCache.set(blobKey, entry)
  }

  setHeader(event, 'Content-Type', file === 'tokens.json' ? 'application/json' : 'text/css')
  setHeader(event, 'Cache-Control', 'public, max-age=60, must-revalidate')
  setHeader(event, 'Access-Control-Allow-Origin', origin ?? '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET')
  setHeader(event, 'Vary', 'Origin')
  setHeader(event, 'ETag', entry.etag)

  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  if (ifNoneMatch === entry.etag) {
    setResponseStatus(event, 304)
    return ''
  }

  return entry.body
})

function matchOrigin(pattern: string, origin: string): boolean {
  const host = origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (pattern === host) return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return host === suffix || host.endsWith('.' + suffix)
  }
  return false
}
