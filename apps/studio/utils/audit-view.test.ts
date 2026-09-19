import { describe, expect, it } from 'vitest'
import {
  actorLabel,
  auditObject,
  changeSummary,
  dayLabel,
  initials,
  periodStart,
  timeOfDay,
} from './audit-view'

const row = (over: Partial<Parameters<typeof auditObject>[0]> = {}) => ({
  actorEmail: 'lars@klanghaus.dk',
  targetLabel: null,
  before: null,
  after: null,
  ...over,
})

describe('auditObject', () => {
  it('joins target and before → after on one line', () => {
    expect(
      auditObject(
        row({ targetLabel: 'Lars', before: { role: 'member' }, after: { role: 'viewer' } }),
      ),
    ).toBe('Lars: member → viewer')
  })
  it('falls back to whichever part exists', () => {
    expect(auditObject(row({ targetLabel: 'Production key' }))).toBe('Production key')
    expect(auditObject(row({ after: { version: 3 } }))).toBe('v3')
    expect(auditObject(row())).toBe('')
  })
  it('keeps the previous value (completeness over density)', () => {
    expect(changeSummary({ before: { role: 'admin' }, after: { role: 'member' } })).toContain(
      'admin',
    )
  })
})

describe('actorLabel and initials', () => {
  it('prefers the name, then the email, then null (system)', () => {
    expect(actorLabel({ actorName: 'Allan Christensen', actorEmail: 'a@k.dk' })).toBe(
      'Allan Christensen',
    )
    expect(actorLabel({ actorName: '', actorEmail: 'a@k.dk' })).toBe('a@k.dk')
    expect(actorLabel({ actorEmail: null })).toBeNull()
  })
  it('derives initials from a name or an email', () => {
    expect(initials('Allan Christensen')).toBe('AC')
    expect(initials('redesign-screens@grundtone.local')).toBe('R')
  })
})

describe('dayLabel', () => {
  const now = new Date(2026, 8, 17, 14, 0)
  it('says today and yesterday in the locale', () => {
    expect(dayLabel('2026-09-17', now, 'en')).toBe('Today')
    expect(dayLabel('2026-09-16', now, 'en')).toBe('Yesterday')
    expect(dayLabel('2026-09-16', now, 'da')).toBe('I går')
  })
  it('uses a short date otherwise, with the year only when it differs', () => {
    expect(dayLabel('2026-07-21', now, 'en')).toBe('Jul 21')
    expect(dayLabel('2025-07-21', now, 'en')).toBe('Jul 21, 2025')
  })
})

describe('timeOfDay', () => {
  it('is hours and minutes', () => {
    expect(timeOfDay('2026-09-17T12:20:00Z', 'en')).toMatch(/^\d{2}:\d{2}( [AP]M)?$/)
  })
})

describe('periodStart', () => {
  const now = new Date('2026-09-17T12:00:00Z')
  it('has no bound for All (the default on a compliance surface)', () => {
    expect(periodStart('all', now)).toBeUndefined()
  })
  it('bounds 7/30/90 days back', () => {
    expect(periodStart('7d', now)?.toISOString()).toBe('2026-09-10T12:00:00.000Z')
    expect(periodStart('90d', now)?.toISOString()).toBe('2026-06-19T12:00:00.000Z')
  })
})
