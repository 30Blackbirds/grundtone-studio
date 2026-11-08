import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compare,
  CouldNotRun,
  listPackages,
  listVendored,
  localProblems,
  readManifest,
  upstreamProblems,
  VENDOR_ROOT,
} from '../scripts/vendor-drift.mjs'

/**
 * The vendored @klanghaus packages (KH-944, Allan 2026-10-24) must stay
 * byte-identical to what was taken from their source repos. Each manifest pins
 * every file's sha256; a hand edit, a formatter run or a stray file turns this
 * red. Upstream drift (the source changed, studio did not) is NOT measured here:
 * that needs the private source repos — `node apps/studio/scripts/vendor-drift.mjs --upstream`.
 */
describe('vendored @klanghaus packages', () => {
  const scratch: string[] = []
  afterEach(() => {
    for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const copy = (name: string) => {
    const dir = mkdtempSync(join(tmpdir(), `vendor-${name}-`))
    scratch.push(dir)
    cpSync(join(VENDOR_ROOT, name), dir, { recursive: true })
    return dir
  }

  // auth-jwt left the vendor tree for server/lib/jwt.ts (1amk32fn4a8).
  it('vendors exactly permissions-client', () => {
    expect(listPackages()).toEqual(['permissions-client'])
  })

  it.each(['permissions-client'])('%s matches its manifest', (name) => {
    expect(localProblems(join(VENDOR_ROOT, name))).toEqual([])
  })

  it.each([['permissions-client', '@klanghaus/permissions-client', 3]])(
    '%s: the manifest names %s and covers %i files from one commit',
    (name, pkg, count) => {
      const dir = join(VENDOR_ROOT, name)
      const m = readManifest(dir)
      expect(m.package).toBe(pkg)
      expect(m.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
      expect(Object.keys(m.files)).toHaveLength(count)
      expect(listVendored(dir)).toEqual(Object.keys(m.files).sort())
    },
  )

  it('CONTROL: a one-byte edit is reported as changed', () => {
    const dir = copy('permissions-client')
    const file = join(dir, 'src/connect.ts')
    writeFileSync(file, readFileSync(file, 'utf8') + ' ')
    expect(localProblems(dir)).toEqual([expect.stringMatching(/^changed: src\/connect\.ts /)])
  })

  it('CONTROL: an extra file and a missing file are both reported', () => {
    const dir = copy('permissions-client')
    writeFileSync(join(dir, 'src/extra.ts'), 'export {}\n')
    rmSync(join(dir, 'src/connect.ts'))
    expect(localProblems(dir).sort()).toEqual([
      'missing: src/connect.ts',
      'not in manifest: src/extra.ts',
    ])
  })

  it('CONTROL: an empty manifest is a problem, never "0 files identical"', () => {
    expect(compare({}, {})).toEqual(['manifest lists no files'])
  })

  it('compare treats a null hash (deleted upstream) as missing', () => {
    expect(compare({ 'a.ts': 'x' }, { 'a.ts': null })).toEqual(['missing: a.ts'])
  })

  // The upstream mode, provoked with an injected fetcher so every outcome —
  // identical, drift, cannot see, nothing compared — runs without network.
  // Cells taken from auth#183 ([sikkerhed], #354 verdict). Its live run
  // against the source repos is the Jenkins check on main.
  describe.each(['permissions-client'])('upstream: %s', (name) => {
    const dir = join(VENDOR_ROOT, name)
    const manifest = readManifest(dir)
    const bytes = (path: string) => readFileSync(join(dir, path))
    const sameEverywhere = (path: string) => Promise.resolve(bytes(path))
    const [first, second] = Object.keys(manifest.files)

    it('identical at ref → no problems', async () => {
      expect(await upstreamProblems(manifest, sameEverywhere, 'main')).toEqual([])
    })

    it('changed or deleted at ref → drift, named per file', async () => {
      const fetchFile = (path: string, ref: string) => {
        if (ref === manifest.sourceCommit) return Promise.resolve(bytes(path))
        if (path === first) return Promise.resolve(Buffer.from('changed'))
        if (path === second) return Promise.resolve(null)
        return Promise.resolve(bytes(path))
      }
      expect((await upstreamProblems(manifest, fetchFile, 'main')).sort()).toEqual(
        [expect.stringMatching(new RegExp(`^changed: ${first}`)), `missing: ${second}`].sort(),
      )
    })

    it('CONTROL: 404 at the pinned commit means "cannot see", not drift', async () => {
      const blind = () => Promise.resolve(null)
      await expect(upstreamProblems(manifest, blind, 'main')).rejects.toThrow(CouldNotRun)
      await expect(upstreamProblems(manifest, blind, 'main')).rejects.toThrow(/pinned sourceCommit/)
    })

    it('CONTROL: every file 404 at an unknown ref means nothing was compared (exit 2, not 1)', async () => {
      const fetchFile = (path: string, ref: string) =>
        Promise.resolve(ref === manifest.sourceCommit ? bytes(path) : null)
      await expect(upstreamProblems(manifest, fetchFile, 'no-such-ref')).rejects.toThrow(
        /every file is 404/,
      )
    })

    it('CONTROL: a pin whose bytes do not match the manifest is refused', async () => {
      const wrongPin = () => Promise.resolve(Buffer.from('not the pinned bytes'))
      await expect(upstreamProblems(manifest, wrongPin, 'main')).rejects.toThrow(/pin is wrong/)
    })
  })
})
