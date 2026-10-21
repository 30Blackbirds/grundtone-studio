import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
// The schema import chain reaches the db module, which needs a URL at import
// time; postgres.js does not connect until a query runs.
process.env.DATABASE_URL ??= 'postgres://unused@127.0.0.1:1/unused'
const { deleteCondition, retentionCutoffs, stripCondition, IP_UA_MAX_DAYS, SAFETY_MARGIN_DAYS } =
  await import('./audit-retention')

const DAY = 24 * 60 * 60 * 1000
const render = (c: Parameters<PgDialect['sqlToQuery']>[0]) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(c)

describe('🔴 retentionCutoffs: cut before the deadline, not at it', () => {
  const now = new Date('2026-10-21T12:00:00Z')

  it('strips IP/UA at 89 days, so an hourly job keeps every value under 90', () => {
    const { stripBefore } = retentionCutoffs(now)
    expect((now.getTime() - stripBefore.getTime()) / DAY).toBe(IP_UA_MAX_DAYS - SAFETY_MARGIN_DAYS)
    expect(IP_UA_MAX_DAYS - SAFETY_MARGIN_DAYS).toBe(89)
  })

  it('deletes rows at 12 calendar months minus one day', () => {
    expect(retentionCutoffs(now).deleteBefore.toISOString()).toBe('2025-10-22T12:00:00.000Z')
  })

  it('crosses a year boundary and a short month correctly', () => {
    expect(retentionCutoffs(new Date('2026-01-15T00:00:00Z')).deleteBefore.toISOString()).toBe(
      '2025-01-16T00:00:00.000Z',
    )
    // 29 Feb 2028 minus 12 months is 1 Mar 2027 in JS (no 29 Feb 2027), + 1 day.
    expect(retentionCutoffs(new Date('2028-02-29T00:00:00Z')).deleteBefore.toISOString()).toBe(
      '2027-03-02T00:00:00.000Z',
    )
  })

  it('never deletes before it strips: the row cut is always older than the field cut', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-06-30T23:59:59Z', '2028-02-29T00:00:00Z']) {
      const { stripBefore, deleteBefore } = retentionCutoffs(new Date(iso))
      expect(deleteBefore.getTime()).toBeLessThan(stripBefore.getTime())
    }
  })
})

describe('conditions', () => {
  const cut = new Date('2026-07-24T12:00:00Z')

  it('strips only rows past the cut that still carry an IP or a user agent', () => {
    const { sql, params } = render(stripCondition(cut))
    expect(sql).toBe(
      '("audit_log"."created_at" < $1 and ("audit_log"."ip_address" is not null or "audit_log"."user_agent" is not null))',
    )
    expect(params).toEqual([cut.toISOString()])
  })

  it('deletes only rows past the cut', () => {
    const { sql, params } = render(deleteCondition(cut))
    expect(sql).toBe('"audit_log"."created_at" < $1')
    expect(params).toEqual([cut.toISOString()])
  })
})
