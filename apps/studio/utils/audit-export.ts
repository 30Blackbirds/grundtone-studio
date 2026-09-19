// Pure helpers for the audit-log page (R6): day-grouping for the list and
// CSV serialisation for export. Kept out of the component so the grouping/
// escaping semantics are unit-testable.

export interface AuditExportRow {
  id: string
  createdAt: string
  action: string
  actorEmail: string | null
  targetLabel: string | null
  ipAddress: string | null
}

export interface DayGroup<T> {
  /** ISO date (YYYY-MM-DD) in the viewer's local timezone — stable group key. */
  day: string
  rows: T[]
}

export function groupByDay<T extends { createdAt: string }>(rows: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const row of rows) {
    const d = new Date(row.createdAt)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else groups.push({ day, rows: [row] })
  }
  return groups
}

// A field starting with = + - @ (or tab/CR) is run as a formula by Excel and
// LibreOffice. Target labels are user-controlled (project names, emails), so
// such values get a leading apostrophe and export as text (OWASP CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/

function csvField(value: string | null): string {
  if (value === null || value === '') return ''
  if (FORMULA_START.test(value)) value = `'${value}`
  // Quote when the value contains the separator, quotes or newlines; double
  // embedded quotes per RFC 4180.
  if (/[";\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

/** Semicolon-separated (Excel-friendly in da-DK locales), RFC 4180 quoting. */
export function auditCsv(rows: AuditExportRow[]): string {
  const header = ['id', 'createdAt', 'action', 'actorEmail', 'targetLabel', 'ipAddress']
  const lines = [header.join(';')]
  for (const r of rows) {
    lines.push(
      [
        csvField(r.id),
        csvField(r.createdAt),
        csvField(r.action),
        csvField(r.actorEmail),
        csvField(r.targetLabel),
        csvField(r.ipAddress),
      ].join(';'),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
