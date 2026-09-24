import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  scanForHostSources,
  scanForLiterals,
  scannedFiles,
  ALLOWED,
  HOST_ALLOWED,
} from '../scripts/sdk-url-guard.mjs'

// Cells for the guard in scripts/sdk-url-guard.mjs (KH-857 b). The rules live
// in the script so CI can run them without an install, a database or an image;
// these cells drive the same functions with a probe fixture, so the scan is
// exercised on a file that MUST match as well as on the real tree.
//
// What the scan sees and cannot see is documented in the script: non-comment
// lines only, no URL assembled from parts.

const REPO = resolve(process.cwd(), '../..')
const PROBE = 'apps/studio/tests/fixtures/sdk-url-literal.probe.html'
const HOST_PROBE = 'apps/studio/tests/fixtures/cdn-host-source.probe.html'

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

describe('the CDN host has one source (KH-1178)', () => {
  it('finds both a spelled-out host and a direct config read (positive control)', () => {
    // Two rules on two SEPARATE lines in the probe, so both are exercised: a
    // scan that silently stopped matching either would still be green without
    // this. They are separate lines on purpose — one line breaking both rules
    // is deduped to a single finding, which would hide the loss of one rule.
    const hits = scanForHostSources(REPO, [HOST_PROBE])
    expect(hits).toHaveLength(2)
    expect(hits.join('\n')).toContain('https://cdn.grundtone.com')
    expect(hits.join('\n')).toContain('public.cdnBase')
  })

  it('names exactly the files allowed to know the host, and why there are two', () => {
    // 🔴 Spelled out rather than counted: an allow-list that grows silently is
    // how a single-source rule stops meaning anything. Each entry has its
    // reason in the guard.
    expect([...HOST_ALLOWED]).toEqual([
      'apps/studio/composables/useCdnBase.ts',
      // Reads the value in order to REFUSE it; renders nothing.
      'apps/studio/server/plugins/assert-cdn-base.ts',
      // The published SDK runs where there is no runtime config, so its default
      // is part of the published contract rather than a second fallback.
      'packages/saas-client/src/index.ts',
    ])
    expect(scanForHostSources(REPO, [...HOST_ALLOWED])).toEqual([])
  })

  it('🔴 the real tree has no second source', () => {
    expect(scanForHostSources(REPO, scannedFiles(REPO))).toEqual([])
  })

  it('does not trip on the host appearing in prose without a scheme', () => {
    // The discriminating case: an OpenAPI description that mentions
    // cdn.grundtone.com renders nothing and must not be a finding, or the rule
    // gets an allow-list entry per doc string and rots.
    expect(scanForHostSources(REPO, ['apps/studio/server/routes/client/[file].get.ts'])).toEqual([])
  })
})
