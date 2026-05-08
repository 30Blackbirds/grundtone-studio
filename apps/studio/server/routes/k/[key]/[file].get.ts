import { eq, isNull, and } from 'drizzle-orm'
import { db } from '~~/server/db'
import { apiKey, project } from '~~/server/db/schema'
import { hashApiKey } from '~~/server/lib/api-keys'
import { paths, getObjectAsString } from '~~/server/lib/storage'

const VALID_FILES = new Set(['tokens.json', 'tokens.css'])

/**
 * Public CDN-style endpoint mirroring the production URL pattern
 *   cdn.grundtone.io/k/<pk_live_...>/tokens.json
 *
 * In production Bunny.net caches this directly off Object Storage. Locally
 * (and on the origin VM) Nitro resolves the API key to a project, then
 * streams the project's "current" blob from S3-compatible storage.
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')
  const file = getRouterParam(event, 'file')
  if (!key || !file) throw createError({ statusCode: 404 })
  if (!VALID_FILES.has(file)) throw createError({ statusCode: 404 })

  const hash = hashApiKey(key)
  const [row] = await db
    .select({ projectId: apiKey.projectId, allowedOrigins: apiKey.allowedOrigins })
    .from(apiKey)
    .innerJoin(project, eq(project.id, apiKey.projectId))
    .where(and(eq(apiKey.keyHash, hash), isNull(apiKey.revokedAt)))

  if (!row) throw createError({ statusCode: 401, statusMessage: 'Invalid API key' })

  // Origin allowlist: empty = any origin allowed.
  const origin = getRequestHeader(event, 'origin')
  if (row.allowedOrigins.length > 0 && origin) {
    const allowed = row.allowedOrigins.some((pattern) => matchOrigin(pattern, origin))
    if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Origin not allowed' })
  }

  const p = paths(row.projectId)
  const blobKey = file === 'tokens.json' ? p.currentJson : p.currentCss
  const body = await getObjectAsString(blobKey)
  if (!body) throw createError({ statusCode: 404, statusMessage: 'Not published yet' })

  setHeader(event, 'Content-Type', file === 'tokens.json' ? 'application/json' : 'text/css')
  setHeader(event, 'Cache-Control', 'public, max-age=60, must-revalidate')
  setHeader(event, 'Access-Control-Allow-Origin', origin ?? '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET')
  setHeader(event, 'Vary', 'Origin')

  // Don't update last_used_at on every request (ratelimit-style hot path);
  // a periodic background job in Phase 5 can consume access logs instead.

  return body
})

function matchOrigin(pattern: string, origin: string): boolean {
  // Strip protocol from incoming origin
  const host = origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (pattern === host) return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return host === suffix || host.endsWith('.' + suffix)
  }
  return false
}
