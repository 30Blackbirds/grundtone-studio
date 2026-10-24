import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compare,
  listPackages,
  listVendored,
  localProblems,
  readManifest,
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

  it('vendors exactly auth-jwt and permissions-client', () => {
    expect(listPackages()).toEqual(['auth-jwt', 'permissions-client'])
  })

  it.each(['auth-jwt', 'permissions-client'])('%s matches its manifest', (name) => {
    expect(localProblems(join(VENDOR_ROOT, name))).toEqual([])
  })

  it.each([
    ['auth-jwt', '@klanghaus/auth-jwt', 6],
    ['permissions-client', '@klanghaus/permissions-client', 3],
  ])('%s: the manifest names %s and covers %i files from one commit', (name, pkg, count) => {
    const dir = join(VENDOR_ROOT, name)
    const m = readManifest(dir)
    expect(m.package).toBe(pkg)
    expect(m.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(Object.keys(m.files)).toHaveLength(count)
    expect(listVendored(dir)).toEqual(Object.keys(m.files).sort())
  })

  it('CONTROL: a one-byte edit is reported as changed', () => {
    const dir = copy('auth-jwt')
    const file = join(dir, 'src/verify.ts')
    writeFileSync(file, readFileSync(file, 'utf8') + ' ')
    expect(localProblems(dir)).toEqual([expect.stringMatching(/^changed: src\/verify\.ts /)])
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
})
