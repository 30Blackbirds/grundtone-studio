import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { SDK_CONTRACT_MAJOR, SDK_CONTRACT_VERSION } from '~~/utils/sdk-contract'

// The versioned SDK URL (/client/v1.0.0.js) is cached as immutable and pinned by
// customers with SRI, so its bytes may never change without a contract bump
// (KH-988). The SRI for the current contract is committed next to the app, and
// scripts/boot-smoke.sh asserts that the image serves exactly those hashes.
// These cells keep the three pieces in step before an image is ever built.

const CONTRACT_DIR = fileURLToPath(new URL('../sdk-contract/', import.meta.url))
const CONSTANT_FILE = fileURLToPath(new URL('../utils/sdk-contract.ts', import.meta.url))

describe('SDK contract', () => {
  it('is a plain x.y.z version with the major derived from it', () => {
    expect(SDK_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(SDK_CONTRACT_MAJOR).toBe(SDK_CONTRACT_VERSION.split('.')[0])
  })

  it('declares the version on exactly one line in the form boot-smoke.sh parses', () => {
    const lines = readFileSync(CONSTANT_FILE, 'utf8')
      .split('\n')
      .filter((line) => /^export const SDK_CONTRACT_VERSION = '[0-9][0-9.]*'$/.test(line))
    expect(lines).toEqual([`export const SDK_CONTRACT_VERSION = '${SDK_CONTRACT_VERSION}'`])
  })

  it('commits a SHA-384 SRI for both bundles of the current contract, and nothing else', () => {
    expect(readdirSync(CONTRACT_DIR).sort()).toEqual([
      `v${SDK_CONTRACT_VERSION}.js.sri`,
      `v${SDK_CONTRACT_VERSION}.mjs.sri`,
    ])
    for (const ext of ['js', 'mjs']) {
      const sri = readFileSync(`${CONTRACT_DIR}v${SDK_CONTRACT_VERSION}.${ext}.sri`, 'utf8')
      expect(sri).toMatch(/^sha384-[A-Za-z0-9+/]{64}\n$/)
    }
  })
})
