import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { SDK_CONTRACT_MAJOR, SDK_CONTRACT_VERSION } from '~~/utils/sdk-contract'

// The versioned SDK URLs (/client/v<x.y.z>.js) are cached as immutable and pinned
// by customers with SRI (KH-988). Since KH-991 every published version is
// committed under sdk-contract/ and served from there; scripts/sdk-contract-guard.mjs
// owns immutability and completeness of ALL versions (its cells are in
// tests/sdk-contract-guard.test.ts). These cells keep the constant, its parse
// form and the CURRENT version's files in step before an image is ever built.

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

  it('commits all six files of the current contract version, with SHA-384 SRIs', () => {
    const current = readdirSync(CONTRACT_DIR)
      .filter((name) => name.startsWith(`v${SDK_CONTRACT_VERSION}.`))
      .sort()
    expect(current).toEqual(
      ['js', 'js.map', 'js.sri', 'mjs', 'mjs.map', 'mjs.sri'].map(
        (ext) => `v${SDK_CONTRACT_VERSION}.${ext}`,
      ),
    )
    for (const ext of ['js', 'mjs']) {
      const sri = readFileSync(`${CONTRACT_DIR}v${SDK_CONTRACT_VERSION}.${ext}.sri`, 'utf8')
      expect(sri).toMatch(/^sha384-[A-Za-z0-9+/]{64}\n$/)
    }
  })
})
