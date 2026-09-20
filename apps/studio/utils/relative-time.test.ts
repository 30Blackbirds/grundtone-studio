import { describe, expect, it } from 'vitest'
import { absoluteDate, activityTone, dayOnly, relativeTime } from './relative-time'

const now = new Date('2026-09-17T12:00:00Z')
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000)

describe('relativeTime', () => {
  it.each([
    [30, 'now'],
    [5 * 60, '5 min. ago'],
    [2 * 3600, '2 hr. ago'],
    [24 * 3600, 'yesterday'],
    [3 * 24 * 3600, '3 days ago'],
    [14 * 24 * 3600, '2 wk. ago'],
    [60 * 24 * 3600, '2 mo. ago'],
    [400 * 24 * 3600, 'last yr.'],
  ])('%is ago → %s (en)', (seconds, expected) => {
    expect(relativeTime(ago(seconds), now, 'en')).toBe(expected)
  })

  it('localises (da)', () => {
    expect(relativeTime(ago(24 * 3600), now, 'da')).toBe('i går')
    expect(relativeTime(ago(2 * 3600), now, 'da')).not.toBe(relativeTime(ago(2 * 3600), now, 'en'))
  })
})

describe('absoluteDate', () => {
  it('is non-empty and contains the year', () => {
    expect(absoluteDate(now, 'en')).toContain('2026')
    expect(absoluteDate(now, 'da')).toContain('2026')
  })
})

describe('activityTone', () => {
  it.each([
    ['config.published', 'publish'],
    ['config.activated', 'publish'],
    ['member.invited', 'member'],
    ['member.role_changed', 'member'],
    ['project.member.added', 'member'],
    ['config.draft_saved', 'neutral'],
    ['api_key.created', 'neutral'],
    ['project.created', 'neutral'],
    ['organization.updated', 'neutral'],
  ])('%s → %s', (action, tone) => {
    expect(activityTone(action)).toBe(tone)
  })
})

describe('dayOnly', () => {
  const d = new Date('2026-06-13T14:35:00Z')

  it('renders a date with no clock, in the active locale', () => {
    expect(dayOnly(d, 'da')).toBe('13. jun. 2026')
    expect(dayOnly(d, 'en')).toBe('Jun 13, 2026')
  })

  it('leaves absoluteDate alone — it still carries the time', () => {
    // The reason dayOnly exists as its own function: audit rows and the hover
    // title behind a relative time need the clock, and a flag on absoluteDate
    // would have been one edit away from dropping it everywhere.
    expect(absoluteDate(d, 'en')).toMatch(/\d{1,2}:\d{2}/)
  })
})
