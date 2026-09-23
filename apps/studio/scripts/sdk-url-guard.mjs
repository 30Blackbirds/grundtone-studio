#!/usr/bin/env node
// Guard: the SDK URL has ONE source (KH-857 b).
//
// /client/v<major>.js and /client/v<x.y.z>.js come from SDK_CONTRACT_MAJOR /
// SDK_CONTRACT_VERSION in utils/sdk-contract.ts. A hardcoded `/client/v1.js`
// elsewhere is how the guide and the artefact drifted apart before: 9 literals
// in 6 files, none derived from anything, while the package said 0.0.1.
//
// It is a plain script, not only a vitest cell, so CI can run it without an
// install, a database or an image — the same shape as sdk-contract-guard.mjs
// and scripts/check-i18n-parity.mjs. The cells in tests/sdk-url-single-source.test.ts
// import scanForLiterals() and drive it with a probe fixture.
//
// 🔴 WHAT IT CANNOT SEE, so the green says what it is worth: a URL assembled
// from parts (`'client/v' + n`), and anything inside a comment. Comments are
// allowed because they explain the contract and never render.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LITERAL = /client\/v\d/
export const COMMENT = /^\s*(\/\/|\/?\*|#|<!--)/
export const SCANNED_DIRS = ['apps/studio', 'packages/saas-client/src']

// Files allowed to spell the URL out, each with its reason.
export const ALLOWED = new Set([
  // The constant's own documentation.
  'apps/studio/utils/sdk-contract.ts',
])

export function scannedFiles(repoRoot) {
  return (
    execFileSync('git', ['ls-files', ...SCANNED_DIRS], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => /\.(ts|vue|js|mjs|html)$/.test(f))
      .filter((f) => !/\.test\.ts$/.test(f))
      .filter((f) => !f.startsWith('apps/studio/sdk-contract/'))
      // The positive-control probe lives here and must not trip the real scan.
      .filter((f) => !f.startsWith('apps/studio/tests/fixtures/'))
  )
}

/** @returns {string[]} `path:line: text` for every hardcoded literal found */
export function scanForLiterals(repoRoot, files) {
  const hits = []
  for (const file of files) {
    if (ALLOWED.has(file)) continue
    readFileSync(resolve(repoRoot, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (LITERAL.test(line) && !COMMENT.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
      })
  }
  return hits
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
  const files = scannedFiles(repoRoot)
  const hits = scanForLiterals(repoRoot, files)

  // The denominator, always: a green that does not say what it scanned cannot
  // be told apart from a green that scanned nothing.
  console.log(
    `sdk-url: scanned ${files.length} file(s) under ${SCANNED_DIRS.join(', ')} ` +
      `(non-comment lines only); ${ALLOWED.size} file(s) allowed to spell the URL out`,
  )
  if (files.length < 100) {
    console.error(
      `✗ only ${files.length} file(s) scanned — the file set collapsed, so a green here would mean nothing`,
    )
    process.exit(2)
  }
  if (hits.length) {
    console.error('✗ hardcoded SDK URL outside utils/sdk-contract.ts:')
    for (const h of hits) console.error(`  ${h}`)
    console.error(
      '  Derive it from SDK_CONTRACT_MAJOR / SDK_CONTRACT_VERSION (utils/install-snippets.ts).',
    )
    process.exit(1)
  }
  console.log('✓ every rendered /client/v… URL comes from the contract constant')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
