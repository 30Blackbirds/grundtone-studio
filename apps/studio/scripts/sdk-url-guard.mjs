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

// 🔴 THE HOST IS THE OTHER HALF OF THE URL (KH-1178). "One source" for the
// VERSION did not make the HOST one source: the guide fell back to a hardcoded
// `https://cdn.grundtone.com` and the in-app snippet to `window.location.origin`,
// so with NUXT_PUBLIC_CDN_BASE unset the two screens announced two different
// hosts to the same customer — and the customer pins an SRI hash against
// whichever one they read. These two rules keep the host single-sourced the
// same way the version is.
//
// The literal needs a SCHEME: what is dangerous is a usable URL, not the host's
// name appearing in prose (an OpenAPI description saying "origin for
// cdn.grundtone.com/client" renders nothing and misleads nobody).
export const HOST_LITERAL = /https?:\/\/cdn\.grundtone\.com/
export const CONFIG_READ = /public\.cdnBase/
export const HOST_ALLOWED = new Set([
  // The one place the host is resolved for Studio's own screens.
  'apps/studio/composables/useCdnBase.ts',
  // The boot refusal reads the same value in order to REFUSE it. It renders
  // nothing and offers no fallback, so it is not a second source — but it must
  // read the produced value rather than the environment variable, or it would
  // pass while the value customers receive came from somewhere else.
  'apps/studio/server/plugins/assert-cdn-base.ts',
  // 🔴 The published SDK is a THIRD source, and deliberately so: it runs in a
  // customer's browser, where there is no Nuxt runtime config to read, so its
  // default IS part of the published contract. Recorded rather than silenced —
  // if Studio's configured host and this default ever disagree, a customer who
  // configures neither gets tokens from a host Studio never told them about.
  // Changing it is a customer-visible contract change, not a refactor.
  'packages/saas-client/src/index.ts',
])
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

/** @returns {string[]} `path:line: text` for every non-comment line matching `pattern` */
export function scanFor(repoRoot, files, pattern, allowed) {
  const hits = []
  for (const file of files) {
    if (allowed.has(file)) continue
    readFileSync(resolve(repoRoot, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line) && !COMMENT.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
      })
  }
  return hits
}

/** @returns {string[]} `path:line: text` for every hardcoded literal found */
export function scanForLiterals(repoRoot, files) {
  return scanFor(repoRoot, files, LITERAL, ALLOWED)
}

/** @returns {string[]} every place the CDN host is spelled out or read directly */
export function scanForHostSources(repoRoot, files) {
  // Deduped: one line can break both rules at once (`public.cdnBase ||
  // 'https://cdn.grundtone.com'` is exactly the shape this exists to catch),
  // and printing it twice makes two findings out of one.
  return [
    ...new Set([
      ...scanFor(repoRoot, files, HOST_LITERAL, HOST_ALLOWED),
      ...scanFor(repoRoot, files, CONFIG_READ, HOST_ALLOWED),
    ]),
  ]
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

  const hostHits = scanForHostSources(repoRoot, files)
  console.log(
    `cdn-host: same ${files.length} file(s); ${HOST_ALLOWED.size} file(s) allowed to read the host`,
  )
  if (hostHits.length) {
    console.error('✗ the CDN host has more than one source:')
    for (const h of hostHits) console.error(`  ${h}`)
    console.error('  Read it through useCdnBase() (composables/useCdnBase.ts) — KH-1178.')
    process.exit(1)
  }
  console.log('✓ every rendered CDN host comes from useCdnBase()')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
