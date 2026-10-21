// Presentation helpers for the Revisionslog table (redesign R3, [designer]
// 2026-09-17). This is a compliance surface: completeness wins over density
// where they conflict, so the object keeps before → after and the IP stays
// visible on every row.

export interface AuditViewRow {
  actorEmail: string | null
  actorName?: string | null
  targetLabel: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/** Before → after summary for the change carried in the row, if any. */
export function changeSummary(row: Pick<AuditViewRow, 'before' | 'after'>): string {
  const { before, after } = row
  if (before && after && 'role' in before && 'role' in after) {
    return `${String(before.role)} → ${String(after.role)}`
  }
  if (after && 'role' in after) return String(after.role)
  if (after && 'version' in after) return `v${String(after.version)}`
  return ''
}

/** The object cell: one mono line, "target: before → after". */
export function auditObject(row: AuditViewRow): string {
  const summary = changeSummary(row)
  if (row.targetLabel && summary) return `${row.targetLabel}: ${summary}`
  return row.targetLabel || summary
}

/**
 * The key behind a machine actor, if the row has one. `known` means the API
 * resolved it within this org; a `machine:` actor it could not resolve (the key
 * was deleted) is still a key and must not be shown as "System".
 */
export function machineActor(row: {
  actorUserId: string | null
  actorKey?: { keyPrefix: string; keyType: string } | null
}): { known: true; keyPrefix: string; keyType: string } | { known: false } | null {
  if (row.actorKey) return { known: true, ...row.actorKey }
  if (row.actorUserId?.startsWith('machine:')) return { known: false }
  return null
}

/** Actor shown as name when present, else email; null for system events. */
export function actorLabel(row: Pick<AuditViewRow, 'actorEmail' | 'actorName'>): string | null {
  return row.actorName || row.actorEmail || null
}

/** Up to two initials from a name, or the first letter of an email's local part. */
export function initials(label: string): string {
  const local = label.includes('@') ? (label.split('@')[0] ?? '') : label
  const parts = local.split(/[\s._-]+/).filter(Boolean)
  const letters = label.includes('@') ? parts.slice(0, 1) : parts.slice(0, 2)
  return letters.map((p) => p[0]!.toUpperCase()).join('')
}

/** Day row label: "Today" / "Yesterday" in the viewer's locale, else a short date. */
export function dayLabel(day: string, now: Date, locale: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (diffDays === 0 || diffDays === -1) {
    const text = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diffDays, 'day')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }
  const sameYear = date.getFullYear() === today.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

/** Time column: hours and minutes in the viewer's time zone. */
export function timeOfDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

/** Full timestamp with time zone, for the time cell's title. */
export function fullTimestamp(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(iso))
}

export type PeriodFilter = 'all' | '7d' | '30d' | '90d'

/** Lower bound for a period filter; undefined means no bound ("All", the default). */
export function periodStart(period: PeriodFilter, now: Date): Date | undefined {
  const days = { all: 0, '7d': 7, '30d': 30, '90d': 90 }[period]
  return days ? new Date(now.getTime() - days * 86_400_000) : undefined
}
