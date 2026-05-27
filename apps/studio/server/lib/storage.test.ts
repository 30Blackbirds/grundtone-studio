import { describe, it, expect } from 'vitest'
import { paths } from './storage'

// Pure-function tests for the storage path helpers. The S3 client +
// putObject / getObjectAsString round-trip needs a live MinIO container,
// which belongs in the e2e suite, not here. This file just locks down
// the *path-shape contract* so a refactor of the helper can't silently
// relocate blobs.

describe('paths', () => {
  const PROJECT = '00000000-0000-0000-0000-000000000abc'

  it('roots every path under p/{projectId}/', () => {
    const p = paths(PROJECT)
    expect(p.currentJson).toBe(`p/${PROJECT}/current.json`)
    expect(p.currentCss).toBe(`p/${PROJECT}/current.css`)
    expect(p.versionedJson(1)).toBe(`p/${PROJECT}/v1/tokens.json`)
    expect(p.versionedCss(1)).toBe(`p/${PROJECT}/v1/tokens.css`)
  })

  it('versionedJson/Css embed the version number verbatim in the path', () => {
    const p = paths(PROJECT)
    expect(p.versionedJson(42)).toBe(`p/${PROJECT}/v42/tokens.json`)
    expect(p.versionedCss(999)).toBe(`p/${PROJECT}/v999/tokens.css`)
  })

  it('the current.* pointers never carry a version suffix', () => {
    // Invariant from architecture-docs: current.json is the mutable pointer
    // that the CDN reads. Embedding a version in its path would break the
    // whole "CDN reads current, Studio reads active_version" handshake.
    const p = paths(PROJECT)
    expect(p.currentJson).not.toMatch(/\/v\d+\//)
    expect(p.currentCss).not.toMatch(/\/v\d+\//)
  })

  it('opt-in version positional arg surfaces versioned blobs as `json`/`css`', () => {
    // The 2-arg form is convenience for handlers that already know which
    // version they're operating on. Without it, callers go through
    // versionedJson(v) / versionedCss(v) explicitly.
    const p = paths(PROJECT, 7)
    expect(p.json).toBe(`p/${PROJECT}/v7/tokens.json`)
    expect(p.css).toBe(`p/${PROJECT}/v7/tokens.css`)
    // versionedJson() / versionedCss() still work alongside it.
    expect(p.versionedJson(8)).toBe(`p/${PROJECT}/v8/tokens.json`)
  })

  it('does not expose json/css fields when no version is given', () => {
    const p = paths(PROJECT) as { json?: string; css?: string }
    expect(p.json).toBeUndefined()
    expect(p.css).toBeUndefined()
  })

  it('treats different project IDs as disjoint namespaces', () => {
    const a = paths('aaa')
    const b = paths('bbb')
    expect(a.currentJson).not.toContain('bbb')
    expect(b.currentJson).not.toContain('aaa')
  })
})
