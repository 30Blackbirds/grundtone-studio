// Days until an invitation expires (redesign R5): drives the pending-list
// "udløber om N dage" label and the <2-days warning color. Calendar-day
// difference in the viewer's local timezone, so "expires tomorrow" reads as
// 1 regardless of time of day; expired invitations go negative.

export function daysUntil(iso: string | Date, now: Date = new Date()): number {
  const target = typeof iso === 'string' ? new Date(iso) : iso
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000)
}
