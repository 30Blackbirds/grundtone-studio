import { describe, it, expect } from 'vitest'
import { daysUntil } from './invite-expiry'

describe('daysUntil', () => {
  const now = new Date('2026-07-29T14:00:00')

  it('counts calendar days, not 24h periods', () => {
    // Tomorrow early morning is still "1 day" even though <24h away.
    expect(daysUntil(new Date('2026-07-30T01:00:00'), now)).toBe(1)
    expect(daysUntil(new Date('2026-08-03T09:00:00'), now)).toBe(5)
  })

  it('returns 0 for later today and negative when expired', () => {
    expect(daysUntil(new Date('2026-07-29T23:59:00'), now)).toBe(0)
    expect(daysUntil(new Date('2026-07-27T10:00:00'), now)).toBe(-2)
  })

  it('accepts ISO strings', () => {
    expect(daysUntil('2026-07-31T00:00:00', now)).toBe(2)
  })
})
