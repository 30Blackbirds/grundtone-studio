import { describe, expect, it } from 'vitest'
import { absoluteDate, activityTone, relativeTime } from './relative-time'

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
