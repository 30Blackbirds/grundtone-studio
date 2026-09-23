import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { scanForLiterals, scannedFiles, ALLOWED } from '../scripts/sdk-url-guard.mjs'

// Cells for the guard in scripts/sdk-url-guard.mjs (KH-857 b). The rules live
// in the script so CI can run them without an install, a database or an image;
// these cells drive the same functions with a probe fixture, so the scan is
// exercised on a file that MUST match as well as on the real tree.
//
// What the scan sees and cannot see is documented in the script: non-comment
// lines only, no URL assembled from parts.

const REPO = resolve(process.cwd(), '../..')
const PROBE = 'apps/studio/tests/fixtures/sdk-url-literal.probe.html'

describe('the SDK URL has one source', () => {
  it('scans a non-trivial set of files (the denominator)', () => {
    // A scan over nothing would be green; the known consumers must be in the set.
    const files = scannedFiles(REPO)
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('apps/studio/components/InstallSnippet.vue')
    expect(files).toContain('apps/studio/utils/install-snippets.ts')
    expect(files).not.toContain(PROBE)
  })

  it('finds a hardcoded URL when one is there (positive control)', () => {
    expect(scanForLiterals(REPO, [PROBE])).toHaveLength(1)
  })

  it('ignores the file allowed to spell the URL out, and only that one', () => {
    expect([...ALLOWED]).toEqual(['apps/studio/utils/sdk-contract.ts'])
    expect(scanForLiterals(REPO, ['apps/studio/utils/sdk-contract.ts'])).toEqual([])
  })

  it('has no hardcoded /client/v<n> outside utils/sdk-contract.ts', () => {
    expect(scanForLiterals(REPO, scannedFiles(REPO))).toEqual([])
  })
})
