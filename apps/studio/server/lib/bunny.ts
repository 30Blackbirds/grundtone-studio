import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { apiKey } from '../db/schema'

// Bunny.net's pull-zone cache sits in front of `/k/<plaintext-key>/<file>`.
// Publish overwrites the `current.*` pointer blobs in object storage, but
// the CDN won't notice until each cached URL's TTL expires (we set
// max-age=60 to keep that window short, but it's still 60s of staleness).
//
// On publish + activate we therefore call Bunny's purge API for every
// non-revoked API key of the project. Bunny accepts wildcards in the purge
// URL, so one call per key handles both tokens.json and tokens.css.
//
// Required env (production):
//   BUNNY_PURGE_API_KEY  — account-level Account API key from Bunny dashboard
//                          (Account Settings → API). Not a storage-zone
//                          password — nothing here uploads to Bunny Storage.
//   NUXT_PUBLIC_CDN_BASE — the CDN host (e.g. https://cdn.grundtone.com).
//
// If either is unset the function logs a single line and exits — that's the
// dev path where we don't have a real CDN to purge. Production deploys must
// set both or publishes silently leave the CDN stale.

const PURGE_ENDPOINT = 'https://api.bunny.net/purge'

interface BunnyPurgeOptions {
  // Override the apiKey lookup — passing a list short-circuits the DB query
  // and is used by the activate handler when it already has the keys in scope.
  keyPrefixes?: string[]
}

/**
 * Purge Bunny.net's cache for every non-revoked API key on a project. Returns
 * the number of URLs purged. Truly fire-and-forget — wraps the whole body
 * (DB lookup included) in try/catch so any failure (DB blip, network, Bunny
 * 5xx) is logged but never propagates to the publish/activate handler.
 *
 * Note: this function still awaits the fetch round-trips internally so the
 * caller can use `void purgeProjectCdn(...)` to dispatch it without blocking
 * the response. See `publish.post.ts` / `activate.post.ts` for the
 * non-blocking call pattern.
 */
export async function purgeProjectCdn(
  projectId: string,
  opts: BunnyPurgeOptions = {},
): Promise<number> {
  try {
    const apiToken = process.env.BUNNY_PURGE_API_KEY
    const cdnBase = process.env.NUXT_PUBLIC_CDN_BASE

    if (!apiToken || !cdnBase) {
      console.info(
        `[bunny] purge skipped for project ${projectId} — BUNNY_PURGE_API_KEY or NUXT_PUBLIC_CDN_BASE unset (dev/test env)`,
      )
      return 0
    }

    let prefixes = opts.keyPrefixes
    if (!prefixes) {
      const rows = await db
        .select({ keyPrefix: apiKey.keyPrefix })
        .from(apiKey)
        .where(and(eq(apiKey.projectId, projectId), isNull(apiKey.revokedAt)))
      prefixes = rows.map((r) => r.keyPrefix)
    }

    if (prefixes.length === 0) {
      // No active keys means no customers can be fetching from /k/* yet — the
      // CDN has nothing to purge. Skip without logging noise.
      return 0
    }

    // Bunny's purge API doesn't actually expose the full plaintext key (we
    // only store the prefix). The prefix is enough: /k/{prefix}* matches every
    // cached URL for that key. The `async=true` flag returns immediately and
    // lets Bunny process the purge in the background.
    const base = cdnBase.replace(/\/$/, '')
    const purges = prefixes.map(async (prefix) => {
      const url = `${base}/k/${prefix}*`
      const target = `${PURGE_ENDPOINT}?url=${encodeURIComponent(url)}&async=true`
      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: { AccessKey: apiToken },
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.warn(
            `[bunny] purge returned ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`,
          )
        }
      } catch (err) {
        console.warn(`[bunny] purge failed for ${url}: ${(err as Error)?.message ?? String(err)}`)
      }
    })

    await Promise.all(purges)
    return prefixes.length
  } catch (err) {
    // DB lookup failure or any other unexpected throw — log and swallow so
    // a broken cache invalidation can't take down publish. The CDN converges
    // to the new tokens within max-age=60 anyway.
    console.warn(
      `[bunny] purge crashed for project ${projectId}: ${(err as Error)?.message ?? String(err)}`,
    )
    return 0
  }
}
