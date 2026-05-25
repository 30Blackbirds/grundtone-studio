import { createHash, randomBytes } from 'node:crypto'
import type { ApiKeyEnvironment } from './constants'

// Kept as a local alias for backwards compatibility with existing imports —
// see constants.ts for the canonical const tuple + type.
export type Environment = ApiKeyEnvironment

export interface GeneratedKey {
  plaintext: string
  prefix: string
  hash: string
}

/**
 * Generate a new API key. Returns plaintext (shown once), prefix (stored for
 * UI recognition), and SHA-256 hash (stored for verification). 256 bits of
 * entropy from randomBytes — no need for slow password hashing.
 */
export function generateApiKey(env: Environment): GeneratedKey {
  const random = randomBytes(32).toString('hex')
  const plaintext = `pk_${env}_${random}`
  const prefix = plaintext.slice(0, 12)
  const hash = createHash('sha256').update(plaintext).digest('hex')
  return { plaintext, prefix, hash }
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}
