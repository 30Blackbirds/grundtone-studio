import { describe, expect, it } from 'vitest'
import {
  EXIT_INVALID_TOKENS,
  importBody,
  importExitCode,
  importPath,
  importReportLines,
  parseTokenFile,
  type ImportReport,
} from './import.js'

function report(over: Partial<ImportReport> = {}): ImportReport {
  return {
    total: 0,
    mapped: [],
    converted: [],
    notMapped: [],
    invalid: [],
    notMappedByPrefix: {},
    droppedExtensions: {},
    parseErrors: [],
    overwritten: 0,
    ...over,
  }
}

const entry = (path: string) => ({ code: 'c', path, value: 'v', reason: 'r' })

describe('importPath', () => {
  it('encodes the project id, so an id with a slash cannot reach another route', () => {
    expect(importPath('a/b')).toBe('/api/projects/a%2Fb/tokens/import')
  })
})

describe('importBody', () => {
  it('omits `dark` entirely when no dark file was given', () => {
    // Not `dark: undefined`: JSON.stringify drops it, but an explicit null or
    // {} would be a document the server tries to parse.
    expect(importBody({ a: 1 }, undefined, true)).toEqual({ base: { a: 1 }, dryRun: true })
    expect('dark' in importBody({ a: 1 }, undefined, true)).toBe(false)
  })

  it('carries the dark file when one was given', () => {
    expect(importBody({ a: 1 }, { b: 2 }, false)).toEqual({
      base: { a: 1 },
      dark: { b: 2 },
      dryRun: false,
    })
  })
})

describe('parseTokenFile', () => {
  it('names which of the two files was bad', () => {
    expect(() => parseTokenFile('dark', 'night.json', '{oops')).toThrow(/dark file night\.json/)
  })

  it('returns the parsed document', () => {
    expect(parseTokenFile('base', 'b.json', '{"color":{"$type":"color"}}')).toEqual({
      color: { $type: 'color' },
    })
  })
})

describe('🔴 importExitCode — what a pipeline reads', () => {
  it('is 0 on a clean write', () => {
    expect(importExitCode(report({ total: 3, mapped: [entry('a')] }), false)).toBe(0)
  })

  it('is non-zero when a WRITE refused tokens', () => {
    expect(importExitCode(report({ invalid: [entry('spacing.neg')] }), false)).toBe(
      EXIT_INVALID_TOKENS,
    )
  })

  it('is non-zero when a write hit structural errors', () => {
    expect(
      importExitCode(report({ parseErrors: [{ path: '$', message: 'too deep' }] }), false),
    ).toBe(EXIT_INVALID_TOKENS)
  })

  it('is 0 for the same report under --dry-run: a question is not a failure', () => {
    expect(importExitCode(report({ invalid: [entry('spacing.neg')] }), true)).toBe(0)
  })

  it("is 0 for tokens merely outside Studio's model, however many", () => {
    // The discriminating case: if this were non-zero, every real import of a
    // foreign file would be red and the code would stop meaning anything.
    expect(
      importExitCode(
        report({
          notMapped: [entry('elevation.a'), entry('elevation.b')],
          notMappedByPrefix: { elevation: 2 },
        }),
        false,
      ),
    ).toBe(0)
  })
})

describe('importReportLines', () => {
  it('leads with the denominator and the four categories', () => {
    const lines = importReportLines(
      {
        saved: false,
        report: report({
          total: 4,
          mapped: [entry('color.primary')],
          converted: [entry('color.brand')],
          notMapped: [entry('elevation.card')],
          invalid: [entry('spacing.neg')],
        }),
      },
      true,
    )
    expect(lines[0]).toBe(
      "4 token(s) in the file(s): 1 mapped (1 converted), 1 outside Studio's model, 1 refused",
    )
  })

  it('says a dry run wrote nothing, and what a real run would overwrite', () => {
    const lines = importReportLines({ saved: false, report: report({ overwritten: 3 }) }, true)
    expect(lines.at(-1)).toContain('nothing written')
    expect(lines.at(-1)).toContain('3 existing value(s)')
  })

  it('names the saved version and the overwrites on a commit', () => {
    const lines = importReportLines(
      { saved: true, version: 7, report: report({ overwritten: 2 }) },
      false,
    )
    expect(lines.at(-1)).toBe('✓ saved draft version 7 (2 existing value(s) overwritten)')
  })

  it('counts not-mapped tokens per prefix and never prints their values (O1)', () => {
    const lines = importReportLines(
      {
        saved: false,
        report: report({
          notMapped: [{ code: 'c', path: 'elevation.card', value: 'SECRET', reason: 'outside' }],
          notMappedByPrefix: { elevation: 1 },
        }),
      },
      true,
    )
    expect(lines.join('\n')).toContain('elevation: 1')
    expect(lines.join('\n')).not.toContain('SECRET')
  })

  it('names dropped vendor extensions, so the loss is visible (I9)', () => {
    const lines = importReportLines(
      { saved: false, report: report({ droppedExtensions: { 'com.example': ['color.primary'] } }) },
      true,
    )
    expect(lines.join('\n')).toContain('com.example: color.primary')
  })

  it('says that structural errors imported nothing', () => {
    const lines = importReportLines(
      { saved: false, report: report({ parseErrors: [{ path: '$.a', message: 'too deep' }] }) },
      true,
    )
    expect(lines.join('\n')).toContain('nothing was imported')
    expect(lines.join('\n')).toContain('$.a: too deep')
  })
})
