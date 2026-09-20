// Relative time for glanceable places ("since publish", activity rows), as the
// R2 prototype. The exact date stays one hover away: callers put the absolute
// date in the element's title ([designer] 2026-09-17).

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

export function relativeTime(date: Date, now: Date, locale: string): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit)
  }
  return rtf.format(0, 'second')
}

export function absoluteDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/**
 * Date without a time, for columns where the clock is noise — "Added",
 * "Invited" in the R5 members tables, which the prototype renders as
 * "13. jun 2026".
 *
 * Separate from `absoluteDate` rather than a flag on it: that one carries a
 * time on purpose (audit rows, and the hover title behind a relative time),
 * and changing it would quietly drop the clock everywhere it is read.
 */
export function dayOnly(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

// Dot colour for a dashboard activity row, mapped against the prototype's three
// examples: publish = primary, member changes = success, everything else neutral.
export type ActivityTone = 'publish' | 'member' | 'neutral'

export function activityTone(action: string): ActivityTone {
  if (action === 'config.published' || action === 'config.activated') return 'publish'
  if (action.startsWith('member.') || action.startsWith('project.member.')) return 'member'
  return 'neutral'
}
