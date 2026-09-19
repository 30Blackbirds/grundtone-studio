// `grundtone-tokens export`: the Studio server does the DTCG conversion
// (GET /api/projects/{id}/tokens/export), so the CLI and the web UI always
// produce the same files. This module holds the parts worth testing without a
// network: argument checks, which files to fetch, and the printed report.

export type ExportSource = 'draft' | 'active'
export type ExportPart = 'base' | 'dark' | 'resolver'

export interface ExportReportResponse {
  source: ExportSource
  version: number
  files: Record<ExportPart, string | null>
  report: {
    total: number
    exported: number
    omitted: { path: string; value: string; reason: string }[]
    converted: { path: string; value: string; reason: string }[]
  }
}

export function checkExportOptions(opts: { format: string; source?: string }): ExportSource {
  if (opts.format !== 'dtcg') throw new Error(`unsupported --format ${opts.format} (only dtcg)`)
  if (opts.source !== 'draft' && opts.source !== 'active') {
    throw new Error('--source must be draft or active')
  }
  return opts.source
}

export function exportPath(projectId: string, source: ExportSource, part: ExportPart | 'report') {
  return `/api/projects/${encodeURIComponent(projectId)}/tokens/export?source=${source}&part=${part}`
}

/** The files the server says exist, in the order they should be written. */
export function filesToFetch(res: ExportReportResponse): { part: ExportPart; name: string }[] {
  return (['base', 'dark', 'resolver'] as const).flatMap((part) => {
    const name = res.files[part]
    // The name comes from the server; never let it pick a directory.
    if (name !== null && !/^[a-z0-9-]+(\.dark)?\.(tokens|resolver)\.json$/.test(name)) {
      throw new Error(`server returned an unexpected file name: ${name}`)
    }
    return name ? [{ part, name }] : []
  })
}

export function reportLines(res: ExportReportResponse): string[] {
  const { report } = res
  const lines = [
    `${report.exported} of ${report.total} tokens exported from ${res.source} version ${res.version}`,
  ]
  if (report.omitted.length) {
    lines.push(`left out (${report.omitted.length}):`)
    for (const e of report.omitted) lines.push(`  ${e.path} = ${e.value}: ${e.reason}`)
  }
  if (report.converted.length) {
    lines.push(`converted (${report.converted.length}):`)
    for (const e of report.converted) lines.push(`  ${e.path} = ${e.value}: ${e.reason}`)
  }
  return lines
}
