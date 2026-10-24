#!/usr/bin/env node
// Drift check for the vendored @klanghaus packages in server/vendor/ (KH-944,
// Allan 2026-10-24: vendor @klanghaus/auth-jwt and @klanghaus/permissions-client
// into studio, as account did with eventcontract, instead of fetching them from
// GitHub Packages with a token).
//
// Each package lives in server/vendor/<name>/ next to a manifest.json that names
// the source repo, path, tag and commit and pins every file's sha256.
//
// Two questions, two modes, because they need different access:
//
//   1. LOCAL (default; no network): is every vendored copy still byte-identical
//      to its manifest? Catches a hand edit, a formatter run, or a file added or
//      lost. Runs in the test suite (tests/vendored-packages.test.ts).
//
//   2. UPSTREAM (`--upstream [ref]`): does the source repo at `ref` (default
//      `main`) still hold the same bytes? Catches an upstream change studio has
//      not taken. Needs read access to the private source repos through `gh`, so
//      it is NOT in the test suite.
//
// Exit 0 = identical, 1 = drift (every differing file listed), 2 = the check
// itself could not run. A check that could not run must never read as "no
// drift": an empty answer from `gh` is exit 2, not 0.
//
// Ported from account's scripts/eventcontract-drift.mjs (account#169).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VENDOR_ROOT = fileURLToPath(new URL('../server/vendor/', import.meta.url))
export const MANIFEST_NAME = 'manifest.json'

/**
 * @typedef {{ package: string, sourceRepo: string, sourcePath: string, sourceCommit: string, files: Record<string, string> }} Manifest
 * @typedef {Record<string, string | null>} Hashes path → sha256, null = missing on that side
 */

/** @param {string | Buffer} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The vendored package directories, by name. */
export function listPackages(root = VENDOR_ROOT) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** @returns {Manifest} */
export function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8'))
}

/** Every file under `dir` except the manifest, as posix paths relative to it. */
export function listVendored(dir) {
  /** @type {string[]} */
  const out = []
  /** @param {string} d */
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(dir, full).split('\\').join('/'))
    }
  }
  walk(dir)
  return out.filter((f) => f !== MANIFEST_NAME).sort()
}

/**
 * Compares expected hashes with actual ones. `actual` maps path → sha256, or
 * → null when the file is missing on that side. Returns one line per problem.
 * @param {Record<string, string>} expected
 * @param {Hashes} actual
 * @returns {string[]}
 */
export function compare(expected, actual) {
  /** @type {string[]} */
  const problems = []
  // An empty manifest would compare nothing and pass: the check must never be
  // able to say "identical" about zero files.
  if (Object.keys(expected).length === 0) problems.push('manifest lists no files')
  for (const [path, want] of Object.entries(expected)) {
    const got = actual[path]
    if (got === undefined || got === null) problems.push(`missing: ${path}`)
    else if (got !== want)
      problems.push(`changed: ${path} (manifest ${want.slice(0, 12)}, found ${got.slice(0, 12)})`)
  }
  for (const path of Object.keys(actual)) {
    if (!(path in expected)) problems.push(`not in manifest: ${path}`)
  }
  return problems
}

/** @param {string} dir one vendored package directory */
export function localProblems(dir) {
  const manifest = readManifest(dir)
  const actual = Object.fromEntries(
    listVendored(dir).map((f) => [f, sha256(readFileSync(join(dir, f)))]),
  )
  return compare(manifest.files, actual)
}

/**
 * @param {string} dir
 * @param {string} ref
 */
function upstreamProblems(dir, ref) {
  const manifest = readManifest(dir)
  /** @type {Hashes} */
  const actual = {}
  for (const path of Object.keys(manifest.files)) {
    const apiPath = `repos/${manifest.sourceRepo}/contents/${manifest.sourcePath}/${path}?ref=${encodeURIComponent(ref)}`
    let body
    try {
      body = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', apiPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      const err = /** @type {Error & { stderr?: Buffer }} */ (e)
      const stderr = err.stderr?.toString() ?? ''
      // 404 on one file is drift (the file moved or was deleted upstream).
      // Anything else (auth, network) means the check did not run.
      if (/HTTP 404/.test(stderr)) {
        actual[path] = null
        continue
      }
      throw new Error(`gh api ${apiPath} failed: ${stderr.trim() || err.message}`, { cause: e })
    }
    if (body.length === 0) throw new Error(`gh api ${apiPath} returned 0 bytes`)
    actual[path] = sha256(body)
  }
  return compare(manifest.files, actual)
}

/** @param {string[]} argv */
function main(argv) {
  const i = argv.indexOf('--upstream')
  const mode = i === -1 ? 'local' : 'upstream'
  const ref = argv[i + 1] ?? 'main'
  let packages
  try {
    packages = listPackages()
  } catch (err) {
    console.error(`vendor drift check could not run: ${err instanceof Error ? err.message : err}`)
    return 2
  }
  if (packages.length === 0) {
    console.error(`vendor drift check could not run: no packages under ${VENDOR_ROOT}`)
    return 2
  }
  let failed = 0
  for (const name of packages) {
    const dir = join(VENDOR_ROOT, name)
    let problems
    try {
      problems = mode === 'local' ? localProblems(dir) : upstreamProblems(dir, ref)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`${name}: drift check could not run (${mode}): ${message}`)
      return 2
    }
    if (problems.length === 0) {
      const n = Object.keys(readManifest(dir).files).length
      console.log(`${name} ${mode}: ${n} files identical to the manifest`)
      continue
    }
    failed += 1
    console.error(`${name} ${mode} drift (${problems.length}):`)
    for (const p of problems) console.error(`  ${p}`)
  }
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
