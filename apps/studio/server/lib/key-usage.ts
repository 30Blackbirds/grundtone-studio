import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { apiKey } from '~~/server/db/schema'
import { TTLCache } from '~~/server/lib/ttl-cache'

// `api_key.last_used_at` is WRITTEN here, and before this it was written
// nowhere (KH-987).
//
// 🔴 THE BUG WAS NOT AN EMPTY FIELD, IT WAS A PLAUSIBLE WRONG ANSWER. The
// column was read in server/api/projects/[projectId]/api-keys.get.ts and
// rendered in ApiKeyManager.vue as "sidst brugt", so a customer — and support,
// and anyone asking "is this leaked key in use?" — read "never used" about a
// key that might be serving thousands of requests a minute. An empty field you
// notice; a confident wrong one you act on.
//
// 🔴 BOTH KEY TYPES, OR THE FIELD STAYS A LIE FOR HALF THE ROWS. api-keys.get
// filters on project, NOT on keyType, so the same screen lists `pk_` (CDN) and
// `sk_` (token CLI) keys side by side. Writing on only the CDN path would have
// left every `sk_` row reading "never used" — the same wrong answer, now harder
// to spot because the rows above it had become right.

/** At most one write per key per hour, per process. */
export const THROTTLE_MS = 60 * 60 * 1000

/**
 * Keys written recently, so the hot path does not issue an UPDATE per request.
 *
 * 🔴 THE THROTTLE IS PER PROCESS, and that is a property of the answer, not an
 * implementation detail: with N app instances the column can be written up to N
 * times per hour per key, and a key used only by an instance that just started
 * is written immediately. What the column therefore MEANS is "used at or after
 * this time", never "used exactly then" — which is enough for support, for a
 * leaked-key question and for the UI's day-resolution display, and is not
 * enough for anything that needs request-level timing. Nothing in this codebase
 * asks for that; if something does, it needs a request log, not this column.
 */
const written = new TTLCache<string, number>(5000, THROTTLE_MS)

/**
 * Should this use be written, given what this process last wrote for the key?
 *
 * Split out from the write so the decision can be driven directly — the write
 * itself needs a database, and a cell that needs a database tends to be the
 * cell nobody runs.
 */
export function shouldRecordUse(lastWrittenAt: number | undefined, now: number): boolean {
  if (lastWrittenAt === undefined) return true
  return now - lastWrittenAt >= THROTTLE_MS
}

/**
 * Record that a key was presented and accepted.
 *
 * 🔴 NEVER THROWS AND NEVER AWAITED ON THE HOT PATH. This is a usage signal, not
 * part of serving the request: a database hiccup must not turn a working CDN
 * response into a 500. The cost of that choice is stated rather than hidden — a
 * failed write is invisible here, so the column can under-report, and it is the
 * wrong instrument for anything that must not miss an event.
 */
export function recordKeyUse(keyHash: string, now = Date.now()): void {
  if (!shouldRecordUse(written.get(keyHash), now)) return
  // Marked BEFORE the await: two concurrent requests for the same key on the
  // same process would otherwise both see "not written" and both issue an
  // UPDATE.
  written.set(keyHash, now)

  void db
    .update(apiKey)
    .set({ lastUsedAt: new Date(now) })
    .where(eq(apiKey.keyHash, keyHash))
    .catch(() => {
      // Deliberately silent at the call site; see the note above. The write is
      // retried at the next throttle window.
    })
}
