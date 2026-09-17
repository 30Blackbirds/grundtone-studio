import { describe, expect, it } from 'vitest'
import {
  checkExportOptions,
  exportPath,
  filesToFetch,
  reportLines,
  type ExportReportResponse,
} from './export'

const response: ExportReportResponse = {
  source: 'active',
  version: 4,
  files: {
    base: 'main.tokens.json',
    dark: 'main.dark.tokens.json',
    resolver: 'main.resolver.json',
  },
  report: {
    total: 3,
    exported: 2,
    omitted: [
      {
        path: 'colors.text',
        value: 'var(--x)',
        reason: 'a var() reference has no fixed color to export',
      },
    ],
    converted: [],
  },
}

describe('export command', () => {
  it('requires --format dtcg and an explicit --source', () => {
    expect(checkExportOptions({ format: 'dtcg', source: 'active' })).toBe('active')
    expect(() => checkExportOptions({ format: 'dtcg' })).toThrow('--source')
    expect(() => checkExportOptions({ format: 'figma', source: 'draft' })).toThrow('--format')
  })

  it('builds the endpoint path per part', () => {
    expect(exportPath('p 1', 'draft', 'resolver')).toBe(
      '/api/projects/p%201/tokens/export?source=draft&part=resolver',
    )
  })

  it('fetches only the files the server reports, base first', () => {
    expect(filesToFetch(response).map((f) => f.part)).toEqual(['base', 'dark', 'resolver'])
    expect(
      filesToFetch({ ...response, files: { base: 'a.tokens.json', dark: null, resolver: null } }),
    ).toEqual([{ part: 'base', name: 'a.tokens.json' }])
  })

  it('refuses a file name that could leave the output directory', () => {
    expect(() =>
      filesToFetch({ ...response, files: { base: '../../.bashrc', dark: null, resolver: null } }),
    ).toThrow('unexpected file name')
  })

  it('prints the denominator and every omitted token', () => {
    expect(reportLines(response)).toEqual([
      '2 of 3 tokens exported from active version 4',
      'left out (1):',
      '  colors.text = var(--x): a var() reference has no fixed color to export',
    ])
  })
})
