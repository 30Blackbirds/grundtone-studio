// `grundtone-tokens import`: the Studio server does the DTCG mapping
// (POST /api/projects/{id}/tokens/import), so the CLI and the web UI report the
// same four categories from the same code. This module holds the parts worth
// testing without a network: reading the files, the request body, the printed
// report and the exit code.
//
// 🔴 The exit code is the point of the command. A CLI that prints a warning and
// exits 0 is read by a pipeline as "fine"; C2 therefore requires a non-zero exit
// when the file carried tokens Studio refused AND the run actually wrote
// something. A --dry-run is a question, not a write, so it exits 0 whatever the
// answer is.

export interface ImportEntry {
  code: string
  path: string
  value: string
  reason: string
}

export interface ImportReport {
  total: number
  mapped: ImportEntry[]
  converted: ImportEntry[]
  notMapped: ImportEntry[]
  invalid: ImportEntry[]
  notMappedByPrefix: Record<string, number>
  droppedExtensions: Record<string, string[]>
  parseErrors: { path: string; message: string }[]
  overwritten: number
}

export interface ImportResponse {
  report: ImportReport
  version?: number
  saved: boolean
}

/** Exit codes the command can end on; 1 stays the top-level error code. */
export const EXIT_INVALID_TOKENS = 2

export function importPath(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/tokens/import`
}

export function importBody(base: unknown, dark: unknown | undefined, dryRun: boolean) {
  return dark === undefined ? { base, dryRun } : { base, dark, dryRun }
}

/**
 * Parse a token file, naming the file in the error.
 *
 * The JSON is parsed HERE rather than posted as text so a typo fails before a
 * request is made, and the person is told which of the two files was wrong —
 * the server sees one body and cannot say.
 */
export function parseTokenFile(label: string, path: string, contents: string): unknown {
  try {
    return JSON.parse(contents)
  } catch (err) {
    throw new Error(`${label} file ${path} is not valid JSON: ${(err as Error).message}`)
  }
}

export function importReportLines(res: ImportResponse, dryRun: boolean): string[] {
  const { report } = res
  const lines: string[] = []

  // The denominator first: the four categories sum to `total`, so a report
  // cannot quietly leave tokens out.
  lines.push(
    `${report.total} token(s) in the file(s): ${report.mapped.length} mapped ` +
      `(${report.converted.length} converted), ${report.notMapped.length} outside Studio's model, ` +
      `${report.invalid.length} refused`,
  )

  if (report.parseErrors.length) {
    lines.push(`structural errors (${report.parseErrors.length}) — nothing was imported:`)
    for (const e of report.parseErrors) lines.push(`  ${e.path}: ${e.message}`)
  }

  if (report.invalid.length) {
    lines.push(`refused (${report.invalid.length}):`)
    for (const e of report.invalid) lines.push(`  ${e.path} = ${e.value}: ${e.reason}`)
  }

  // Counts per top-level path, not values (O1).
  const prefixes = Object.entries(report.notMappedByPrefix).sort((a, b) => b[1] - a[1])
  if (prefixes.length) {
    lines.push(`outside Studio's model, per top-level path:`)
    for (const [prefix, count] of prefixes) lines.push(`  ${prefix}: ${count}`)
  }

  if (report.converted.length) {
    lines.push(`converted (${report.converted.length}):`)
    for (const e of report.converted) lines.push(`  ${e.path}: ${e.reason}`)
  }

  // What the file carried that Studio does not store, named per vendor (I9).
  const vendors = Object.entries(report.droppedExtensions)
  if (vendors.length) {
    lines.push(`dropped $extensions:`)
    for (const [vendor, paths] of vendors) lines.push(`  ${vendor}: ${paths.join(', ')}`)
  }

  if (dryRun) {
    lines.push(
      report.overwritten > 0
        ? `dry run — nothing written; a real run would overwrite ${report.overwritten} existing value(s)`
        : 'dry run — nothing written',
    )
  } else {
    lines.push(
      `✓ saved draft version ${res.version ?? '?'}` +
        (report.overwritten > 0 ? ` (${report.overwritten} existing value(s) overwritten)` : ''),
    )
  }

  return lines
}

/**
 * 0, or EXIT_INVALID_TOKENS when a WRITE carried refused tokens.
 *
 * Note what this deliberately does NOT fail on: `notMapped`. A file from another
 * tool almost always holds tokens outside Studio's model, so failing on those
 * would make every real import red and train people to ignore the code. Refused
 * tokens are different: they were meant for a Studio slot and did not fit.
 */
export function importExitCode(report: ImportReport, dryRun: boolean): number {
  if (dryRun) return 0
  return report.invalid.length > 0 || report.parseErrors.length > 0 ? EXIT_INVALID_TOKENS : 0
}
