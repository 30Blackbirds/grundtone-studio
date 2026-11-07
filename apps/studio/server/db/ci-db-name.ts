import { createHash } from 'node:crypto'

// The per-build database name for ci-db.ts, in its own module so the cells can
// import it without running the script.
//
// 🔴 Sanitising and truncating BUILD_TAG alone is not injective: `PR-347` and
// `pr_347`, or two tags that only differ past the 63-byte limit, map to the
// same name, and `create` FORCE-drops whatever database has it, i.e. another
// studio build's. A hash of the RAW tag goes at the end, so two different tags
// always get different names while the readable part stays for a human.

/** A postgres identifier holds at most 63 bytes. */
const MAX = 63
const PREFIX = 'studio_'
/** 12 hex characters = 48 bits of the sha256 of the raw tag. */
const HASH_LEN = 12

export function ciDbName(tag: string): string {
  const hash = createHash('sha256').update(tag).digest('hex').slice(0, HASH_LEN)
  const readable = tag
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, MAX - PREFIX.length - 1 - HASH_LEN)
  return `${PREFIX}${readable}_${hash}`
}
