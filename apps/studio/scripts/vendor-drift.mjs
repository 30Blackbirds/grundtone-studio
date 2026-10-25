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
//      not taken. Needs read access to the private source repos (GITHUB_TOKEN,
//      or a logged-in `gh`), so it runs as a Jenkins check on main, not in the
//      test suite. The check first fetches every file at the manifest's own
//      `sourceCommit`, which must exist and match: that is the positive
//      control. A 404 there means the check cannot see upstream (exit 2), and
//      if every file 404s at `ref`, nothing was compared — exit 2 too, never
//      "drift" and never "identical".
//
// Exit 0 = identical, 1 = drift (every differing file listed), 2 = the check
// itself could not run.
//
// The upstream half is auth#183's scripts/permissions-client-drift.mjs,
// taken verbatim ([sikkerhed], #354 verdict); the multi-package loop is
// studio's own. Local half ported from account's eventcontract-drift.mjs.
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
 * @typedef {(path: string, ref: string) => Promise<Buffer | null>} FetchFile null = 404; throws on anything else
 */

/** Thrown when the check could not measure; maps to exit 2. */
export class CouldNotRun extends Error {}

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
 * @param {Manifest} manifest
 * @param {FetchFile} fetchFile
 * @param {string} ref
 * @returns {Promise<string[]>}
 */
export async function upstreamProblems(manifest, fetchFile, ref) {
  const paths = Object.keys(manifest.files)
  if (paths.length === 0) return compare(manifest.files, {})

  // Positive control: the pinned commit must be readable and match.
  for (const path of paths) {
    const body = await fetchFile(path, manifest.sourceCommit)
    if (body === null) {
      throw new CouldNotRun(
        `${path} is 404 at the pinned sourceCommit ${manifest.sourceCommit.slice(0, 12)}: ` +
          'the token cannot see the source repo, or the commit is gone — not drift',
      )
    }
    if (sha256(body) !== manifest.files[path]) {
      throw new CouldNotRun(`${path} at sourceCommit does not match the manifest: the pin is wrong`)
    }
  }

  /** @type {Hashes} */
  const actual = {}
  for (const path of paths) {
    const body = await fetchFile(path, ref)
    actual[path] = body === null ? null : sha256(body)
  }
  if (Object.values(actual).every((h) => h === null)) {
    throw new CouldNotRun(`every file is 404 at ref ${JSON.stringify(ref)}: nothing was compared`)
  }
  return compare(manifest.files, actual)
}

function resolveToken() {
  const env = process.env['GITHUB_TOKEN']?.trim()
  if (env) return env
  try {
    const t = execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (t) return t
  } catch {
    // fall through
  }
  throw new CouldNotRun('no GITHUB_TOKEN and no logged-in gh: cannot read the private source repo')
}

/** @param {Manifest} manifest @returns {FetchFile} */
function githubFetcher(manifest) {
  const token = resolveToken()
  return async (path, ref) => {
    const url = `https://api.github.com/repos/${manifest.sourceRepo}/contents/${manifest.sourcePath}/${path}?ref=${encodeURIComponent(ref)}`
    const res = await globalThis.fetch(url, {
      headers: {
        Accept: 'application/vnd.github.raw',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new CouldNotRun(`GET ${url} answered ${res.status}`)
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length === 0) throw new CouldNotRun(`GET ${url} returned 0 bytes`)
    return body
  }
}

/** @param {string[]} argv */
async function main(argv) {
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
      if (mode === 'local') problems = localProblems(dir)
      else {
        const manifest = readManifest(dir)
        problems = await upstreamProblems(manifest, githubFetcher(manifest), ref)
      }
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
  process.exit(await main(process.argv.slice(2)))
}
