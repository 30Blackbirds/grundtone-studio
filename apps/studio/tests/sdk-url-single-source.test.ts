import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// ONE source for the SDK URL (KH-857 b). /client/v<major>.js and
// /client/v<x.y.z>.js come from SDK_CONTRACT_MAJOR / SDK_CONTRACT_VERSION in
// utils/sdk-contract.ts. A hardcoded `/client/v1.js` elsewhere is how the
// guide and the artefact drifted apart before: 9 literals in 6 files, none
// derived from anything, while the package said 0.0.1.
//
// What this cell sees: every tracked file under apps/studio/ and
// packages/saas-client/src/, on lines that are not comments, containing
// `client/v` followed by a digit. What it CANNOT see: a URL assembled from
// parts (`'client/v' + n`), or one inside a comment. Comments are allowed
// because they explain the contract; they do not render.

const REPO = resolve(process.cwd(), '../..')
const LITERAL = /client\/v\d/
const COMMENT = /^\s*(\/\/|\/?\*|#|<!--)/

// Files allowed to spell the URL out, each with its reason.
const ALLOWED = new Set([
  // The constant's own documentation.
  'apps/studio/utils/sdk-contract.ts',
])

function trackedFiles(): string[] {
  return (
    execFileSync('git', ['ls-files', 'apps/studio', 'packages/saas-client/src'], {
      cwd: REPO,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .filter((f) => /\.(ts|vue|js|mjs|html)$/.test(f))
      .filter((f) => !/\.test\.ts$/.test(f))
      .filter((f) => !f.startsWith('apps/studio/sdk-contract/'))
      // The positive-control probe below lives here and must not trip the real cell.
      .filter((f) => !f.startsWith('apps/studio/tests/fixtures/'))
  )
}

function hardcoded(files: string[]): string[] {
  const hits: string[] = []
  for (const file of files) {
    if (ALLOWED.has(file)) continue
    readFileSync(resolve(REPO, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (LITERAL.test(line) && !COMMENT.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
      })
  }
  return hits
}

describe('the SDK URL has one source', () => {
  it('scans a non-trivial set of files (the denominator)', () => {
    // A cell that scanned nothing would be green; the known consumers must be in the set.
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('apps/studio/components/InstallSnippet.vue')
    expect(files).toContain('apps/studio/utils/install-snippets.ts')
  })

  it('finds a hardcoded URL when one is there (positive control)', () => {
    const probe = resolve(REPO, 'apps/studio/tests/fixtures/sdk-url-literal.probe.html')
    expect(hardcoded([probe.slice(REPO.length + 1)])).toHaveLength(1)
  })

  it('has no hardcoded /client/v<n> outside utils/sdk-contract.ts', () => {
    expect(hardcoded(trackedFiles())).toEqual([])
  })
})
