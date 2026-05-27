#!/usr/bin/env node
// Verifies every key in da.json also exists in en.json (and vice versa).
// Danish is the default locale; English is the second locale we ship. The
// realistic drift pattern is "added a new key in da.json, forgot en.json"
// — this script blocks PRs where that happens.
//
// Runs in CI but also locally via `pnpm i18n:check`.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOCALES_DIR = resolve(process.cwd(), 'apps/studio/i18n/locales')
const FILES = ['da.json', 'en.json']

function load(file) {
  const path = resolve(LOCALES_DIR, file)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    console.error(`Failed to read ${path}: ${err.message}`)
    process.exit(2)
  }
}

function collectKeys(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      collectKeys(v, path, out)
    } else {
      out.add(path)
    }
  }
  return out
}

const [daRaw, enRaw] = FILES.map(load)
const daKeys = collectKeys(daRaw)
const enKeys = collectKeys(enRaw)

const onlyDa = [...daKeys].filter((k) => !enKeys.has(k)).sort()
const onlyEn = [...enKeys].filter((k) => !daKeys.has(k)).sort()

if (onlyDa.length === 0 && onlyEn.length === 0) {
  console.log(`✓ i18n parity OK — ${daKeys.size} keys present in both da and en`)
  process.exit(0)
}

if (onlyDa.length > 0) {
  console.error(`\nMissing in en.json (${onlyDa.length}):`)
  for (const k of onlyDa) console.error(`  - ${k}`)
}
if (onlyEn.length > 0) {
  console.error(`\nMissing in da.json (${onlyEn.length}):`)
  for (const k of onlyEn) console.error(`  - ${k}`)
}
console.error('\nAdd the missing keys (or remove the extra ones) in the same change.')
process.exit(1)
