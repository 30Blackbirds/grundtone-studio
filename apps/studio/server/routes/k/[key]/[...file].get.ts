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
import { apiKey, orgSuspension, project } from '~~/server/db/schema'
import { hashApiKey } from '~~/server/lib/api-keys'
import { recordKeyUse } from '~~/server/lib/key-usage'
import { recordCdnGraceCut } from '~~/server/lib/metrics'
import { paths, getObjectAsBuffer, getObjectAsString } from '~~/server/lib/storage'
import { TTLCache } from '~~/server/lib/ttl-cache'
import { SlidingWindowRateLimiter } from '~~/server/lib/rate-limit'

// Filfladen er en LUKKET liste + ét stramt mønster — [...file] er catch-all
// (fonts/<slug>.woff2 har to segmenter), så mønstrene ER traversal-værnet.
// Asset-navnene spejler tokens-schemaets logoFile/fontFile-mønstre.
const TOKEN_FILES = new Set(['tokens.json', 'tokens.css'])
const ASSET_TYPES: Record<string, string> = {
  'logo.svg': 'image/svg+xml',
  'logo.png': 'image/png',
}
const FONT_FILE = /^fonts\/[a-z0-9-]+\.woff2$/

function assetContentType(file: string): string | null {
  if (file in ASSET_TYPES) return ASSET_TYPES[file]
  if (FONT_FILE.test(file)) return 'font/woff2'
  return null
}

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
  organizationId: string
  allowedOrigins: string[]
  rateLimit: number
}
const keyCache = new TTLCache<string, KeyMeta>(5000, 30_000)

// Org-suspension mirror (kontrakt §8a/§9, ToS §10.2): grace timestamp per org,
// written by account's lifecycle callback. 60s TTL keeps the hot path off the
// DB while bounding both directions: a cut lands within a minute of grace
// expiry (well inside the "senest to timer" ToS guarantee, which also covers
// Bunny's edge TTL), and a reactivation resumes delivery within a minute
// ("typisk øjeblikkeligt"). graceUntil null = not suspended.
const suspensionCache = new TTLCache<string, { graceUntil: number | null }>(5000, 60_000)

async function cdnCutAt(organizationId: string): Promise<number | null> {
  let entry = suspensionCache.get(organizationId)
  if (!entry) {
    const [row] = await db
      .select({ cdnGraceUntil: orgSuspension.cdnGraceUntil })
      .from(orgSuspension)
      .where(eq(orgSuspension.organizationId, organizationId))
    entry = { graceUntil: row ? row.cdnGraceUntil.getTime() : null }
    suspensionCache.set(organizationId, entry)
  }
  return entry.graceUntil
}

// Maps the S3 path → { body, etag }. 60s TTL matches the public Cache-Control
// we serve; any new publish overwrites the storage path so a stale cache entry
// only sticks around for one window.
interface BlobEntry {
  body: string | Buffer
  etag: string
}
const blobCache = new TTLCache<string, BlobEntry>(5000, 60_000)

// Sliding window per key, sized to whatever rate_limit is configured per key
// (defaults to 1000/min in the schema). Window matches the typical "requests
// per minute" mental model.
const rateLimiter = new SlidingWindowRateLimiter(60_000, 10_000)

function buildEtag(body: string | Buffer): string {
  return `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`
}

/**
 * Public CDN-style endpoint mirroring the production URL pattern
 *   cdn.grundtone.com/k/<pk_live_...>/tokens.json
 *
 * Pipeline:
 *   1. Resolve API key → project (in-memory cache, DB on miss)
 *   2. Enforce sliding-window rate limit per key (429 over the limit)
 *   3. Origin allowlist check (403 if mismatched)
 *   4. Fetch blob from storage (in-memory cache, S3 on miss)
 *   5. Compare If-None-Match → 304 if client already has the bytes
 *   6. Stream body with ETag + Cache-Control + permissive CORS
 */
defineRouteMeta({
  openAPI: {
    summary:
      'Offentligt CDN-endpoint: API-nøgle → projekt, rate-limit + origin-allowlist + ETag, serverer tokens, logo og fonte.',
    description:
      'Offentligt CDN-endpoint. Oversætter plaintext-API-nøgle til projekt, håndhæver rate-limit, origin-allowlist og ETag, og serverer tokens.json/tokens.css, logo.svg/logo.png og fonts/*.woff2. Fontfiler kræver en Origin-header (licens-omfang, SIK-011); tokens og logo serveres også til server-til-server-kald.',
    tags: ['CDN'],
  },
})

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')
  const file = getRouterParam(event, 'file')
  if (!key || !file) throw createError({ statusCode: 404 })
  const assetType = assetContentType(file)
  if (!TOKEN_FILES.has(file) && !assetType) throw createError({ statusCode: 404 })

  const hash = hashApiKey(key)

  let meta = keyCache.get(hash)
  if (!meta) {
    const [row] = await db
      .select({
        projectId: apiKey.projectId,
        organizationId: project.organizationId,
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

  // The key was presented and accepted — that is what "used" means, so it is
  // recorded here rather than after the rate limit: a key being hammered past
  // its limit is a key in USE, and that is exactly the question a leaked-key
  // investigation asks (KH-987). Throttled and fire-and-forget; never awaited.
  recordKeyUse(hash)

  const limit = rateLimiter.check(hash, meta.rateLimit)
  if (!limit.ok) {
    setHeader(event, 'Retry-After', Math.ceil((limit.resetAt - Date.now()) / 1000))
    throw createError({ statusCode: 429, statusMessage: 'Rate limit exceeded' })
  }

  const origin = getRequestHeader(event, 'origin')

  // ─── SIK-011: fontfiler leveres kun til browser-kald ([jura] 2026-08-05) ──
  //
  // **Dette er IKKE en sikkerhedskontrol.** `Origin` sættes af klienten og kan
  // forfalskes af enhver, der skriver headeren selv. Det er en god-tros-
  // foranstaltning, der gør, at vi leverer inden for det omfang, kunden har
  // erklæret — ikke en spærring, der gør omgåelse umulig. Skriv den ikke om
  // til noget stærkere, end den er.
  //
  // Grænsen her er ikke FORTROLIGHED, men LICENS-OMFANG. En skriftfil er ikke
  // hemmelig — den kan hentes fra ethvert website, der bruger den — men dens
  // distribution er retligt begrænset på en måde, en hex-farvekode ikke er:
  // kommercielle webfont-licenser afgrænses typisk efter domæne og/eller
  // sidevisninger, og et endpoint uden origin-begrænsning gør begge dele
  // meningsløse. Kunden erklærer ved upload, at vi må distribuere filen "til
  // de brugere, der besøger mine brands"; et curl fra en vilkårlig tredjepart
  // er ikke det. Uden denne linje leverede vi mere, end kunden har indestået
  // for — så vi tilpasser leveringen til erklæringen, ikke omvendt.
  //
  // Bryder ikke rigtige browsere: CSS Fonts-specen kræver, at `src: url()`
  // hentes i CORS-anonymous mode, så Origin ledsager ALTID et cross-origin
  // font-kald — og /k er pr. konstruktion cross-origin fra kundens side. Et
  // SAME-origin kald ville mangle headeren, men den vej findes ikke hos os:
  // Studios egen preview bygger fonten med FontFace-API'et fra upload-bytes
  // og rører aldrig /k (verificeret i FontSlotEditor.vue).
  //
  // Tokens og logo er bevidst undtaget: de har legitim server-til-server-brug
  // (fx build-time-hentning af tokens.json), og de bærer ingen licensgrænse.
  //
  // Beskeden nævner `crossorigin` med vilje. MÅLT 2026-08-05 (browser-rig,
  // [sikkerhed]s SIK-011-hypotese): `<link rel=preload as=font>` UDEN
  // crossorigin-attributten hentes i no-cors-mode og sender INTET Origin —
  // både same- og cross-origin. Selve @font-face-hentningen er altid cors og
  // rammes ikke, så kundens font virker stadig; men preloaden bliver en synlig
  // 403 i deres netværkspanel. Uden forklaring bliver det en supportsag om at
  // "Grundtone er nede"; med forklaring bliver det en to-tegns rettelse hos
  // kunden — som samtidig fjerner den dobbelt-hentning, de allerede havde.
  if (FONT_FILE.test(file) && !origin) {
    // Ren tekst med vilje: en HTTP reason-phrase er ikke et sted til markup.
    // h3 sanitizer ikke ved createError, men beskeden passerer header-lag der
    // gør — så vinkelparenteser og anførselstegn kan forsvinde undervejs og
    // efterlade en halv sætning. Klartekst overlever hele vejen.
    throw createError({
      statusCode: 403,
      statusMessage:
        'Origin required for font delivery — add the crossorigin attribute to your font preload link',
    })
  }

  if (meta.allowedOrigins.length > 0 && origin) {
    const allowed = meta.allowedOrigins.some((pattern) => matchOrigin(pattern, origin))
    if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Origin not allowed' })
  }

  // ToS §10.2: suspended orgs keep serving through the account-set grace
  // window, then the CDN goes dark. 410 (not 403) — the resource is gone
  // until reactivation, and permanent-ish semantics stop well-behaved
  // clients from hammering retries.
  const cutAt = await cdnCutAt(meta.organizationId)
  if (cutAt !== null && cutAt <= Date.now()) {
    recordCdnGraceCut()
    throw createError({ statusCode: 410, statusMessage: 'Organization suspended' })
  }

  const p = paths(meta.projectId)
  const blobKey = assetType
    ? p.currentAsset(file)
    : file === 'tokens.json'
      ? p.currentJson
      : p.currentCss

  let entry = blobCache.get(blobKey)
  if (!entry) {
    const body = assetType ? await getObjectAsBuffer(blobKey) : await getObjectAsString(blobKey)
    if (!body) throw createError({ statusCode: 404, statusMessage: 'Not published yet' })
    entry = { body, etag: buildEtag(body) }
    blobCache.set(blobKey, entry)
  }

  const contentType = assetType ?? (file === 'tokens.json' ? 'application/json' : 'text/css')
  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Cache-Control', 'public, max-age=60, must-revalidate')
  setHeader(event, 'Access-Control-Allow-Origin', origin ?? '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET')
  setHeader(event, 'Vary', 'Origin')
  setHeader(event, 'ETag', entry.etag)
  if (assetType) {
    // Låst design (stored-XSS-forsvar i dybden ovenpå upload-saniteringen):
    // /k serverer fra app-origin hvor session-cookies bor. sandbox-CSP'en
    // neutraliserer alt eksekverbart ved DIREKTE navigation til et SVG
    // (script kører i sandboxet null-origin, aldrig mod appens), og nosniff
    // stopper content-type-gætterier på alle asset-svar.
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Content-Security-Policy', "sandbox; default-src 'none'")
  }

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
