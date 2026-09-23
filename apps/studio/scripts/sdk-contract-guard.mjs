#!/usr/bin/env node
// Guard for the committed SDK contract versions (KH-991).
//
// Every file under apps/studio/sdk-contract/ is a version customers may have
// pinned with SRI. Once published it must keep being served BYTE FOR BYTE, so:
//   1. a file that exists on the base branch may never change or disappear —
//      only NEW versions may be added;
//   2. every committed bundle must hash to the SRI committed next to it;
//   3. every version must be complete (js, mjs, both maps, both .sri);
//   4. the current SDK_CONTRACT_VERSION must itself be committed.
//
// The rules live in checkContract(), a pure function over byte maps, so the
// cells can drive it with fixtures instead of a real git history. The CLI at the
// bottom is the thin part that reads the disk and `git show <base>:…`.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION_FILE = /^v(\d+\.\d+\.\d+)\.(js|mjs|js\.map|mjs\.map|js\.sri|mjs\.sri)$/
export const REQUIRED_EXTS = ['js', 'mjs', 'js.map', 'mjs.map', 'js.sri', 'mjs.sri']

const sri = (bytes) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`

/**
 * @param {{ current: Map<string, Buffer>, base: Map<string, Buffer>, contractVersion: string }} input
 * @returns {string[]} violations — empty means the contract directory is sound
 */
export function checkContract({ current, base, contractVersion }) {
  const errors = []

  const versions = new Map()
  for (const name of current.keys()) {
    const m = VERSION_FILE.exec(name)
    if (!m) {
      errors.push(`unexpected file in sdk-contract/: ${name} (only v<x.y.z>.<ext> belongs here)`)
      continue
    }
    if (!versions.has(m[1])) versions.set(m[1], new Set())
    versions.get(m[1]).add(m[2])
  }

  for (const [v, exts] of versions) {
    for (const ext of REQUIRED_EXTS) {
      if (!exts.has(ext)) errors.push(`v${v} is incomplete: v${v}.${ext} is missing`)
    }
  }

  for (const v of versions.keys()) {
    for (const bundle of ['js', 'mjs']) {
      const body = current.get(`v${v}.${bundle}`)
      const committed = current.get(`v${v}.${bundle}.sri`)
      if (!body || !committed) continue
      const calc = sri(body)
      const want = committed.toString('utf8').trim()
      if (calc !== want) {
        errors.push(`v${v}.${bundle} hashes to ${calc}, but v${v}.${bundle}.sri commits ${want}`)
      }
    }
  }

  // Immutability against the base branch. A file the base did not have is an
  // ADDITION and always allowed; a file the base had must be untouched.
  for (const [name, bytes] of base) {
    if (!VERSION_FILE.test(name)) continue
    const now = current.get(name)
    if (!now) {
      errors.push(
        `${name} existed on the base branch and was DELETED — a published contract version must keep being served`,
      )
    } else if (!now.equals(bytes)) {
      errors.push(
        `${name} CHANGED from the base branch — published contract files are immutable; bump SDK_CONTRACT_VERSION and add a new version instead`,
      )
    }
  }

  if (!versions.has(contractVersion)) {
    errors.push(
      `SDK_CONTRACT_VERSION ${contractVersion} has no committed files under sdk-contract/`,
    )
  }

  return errors
}

// ---------------------------------------------------------------- CLI ----
function readContractVersion(studioDir) {
  const src = readFileSync(resolve(studioDir, 'utils/sdk-contract.ts'), 'utf8')
  const found = [...src.matchAll(/^export const SDK_CONTRACT_VERSION = '(\d+\.\d+\.\d+)'$/gm)]
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one SDK_CONTRACT_VERSION in utils/sdk-contract.ts, found ${found.length}`,
    )
  }
  return found[0][1]
}

function readBase(repoRoot, baseRef, relDir) {
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  // 🔴 A MISSING BASE IS AN ERROR, NOT A SKIP. If the ref cannot be resolved the
  // immutability rule — the one this guard exists for — would silently check
  // nothing and stay green. Failing loudly is the only safe answer.
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
  } catch {
    console.error(
      `✗ base revision '${baseRef}' cannot be resolved — immutability was NOT checked. ` +
        'Set SDK_CONTRACT_BASE to a fetched revision (CI needs fetch-depth: 0).',
    )
    process.exit(2)
  }
  const names = git('ls-tree', '-r', '--name-only', baseRef, '--', relDir)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
  const base = new Map()
  for (const path of names)
    base.set(path.slice(relDir.length + 1), git('show', `${baseRef}:${path}`))
  return base
}

function main() {
  const studioDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const repoRoot = resolve(studioDir, '../..')
  const relDir = 'apps/studio/sdk-contract'
  const baseRef = process.env.SDK_CONTRACT_BASE || 'origin/main'

  const contractDir = resolve(repoRoot, relDir)
  const current = new Map(
    readdirSync(contractDir).map((n) => [n, readFileSync(resolve(contractDir, n))]),
  )
  const base = readBase(repoRoot, baseRef, relDir)
  const contractVersion = readContractVersion(studioDir)

  const errors = checkContract({ current, base, contractVersion })
  const versions = new Set(
    [...current.keys()].map((n) => VERSION_FILE.exec(n)?.[1]).filter(Boolean),
  )

  // The denominator, always — a green that does not say what it looked at
  // cannot be told apart from a green that looked at nothing.
  // Two different quantities that can happen to be EQUAL, so they are named:
  // files on disk now, and files the BASE had (every one of those is compared,
  // whether or not the diff touched it — that is why an altered old file
  // cannot hide by being absent from the change set).
  console.log(
    `sdk-contract: ${versions.size} version(s) [${[...versions].sort().join(', ')}]; ` +
      `${current.size} file(s) on disk; ${base.size} file(s) existed on ${baseRef} ` +
      `and were compared byte for byte; current contract ${contractVersion}`,
  )
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`)
    process.exit(1)
  }
  console.log('✓ every committed contract version is complete, self-consistent and unchanged')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
