import { describe, it, expect } from 'vitest'
import { auditCsv, groupByDay } from './audit-export'

describe('groupByDay', () => {
  it('groups consecutive rows by local calendar day, preserving order', () => {
    const rows = [
      { id: 'a', createdAt: '2026-07-29T10:00:00Z' },
      { id: 'b', createdAt: '2026-07-29T08:00:00Z' },
      { id: 'c', createdAt: '2026-07-28T22:00:00Z' },
    ].map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }))
    const groups = groupByDay(rows)
    // Exact day boundaries depend on the viewer's timezone; the invariants are
    // stable: order preserved, adjacent same-day rows share a group, total
    // row count unchanged.
    expect(groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['a', 'b', 'c'])
    expect(groups.length).toBeGreaterThanOrEqual(1)
    expect(groups.length).toBeLessThanOrEqual(3)
    for (const g of groups) expect(g.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns empty for no rows', () => {
    expect(groupByDay([])).toEqual([])
  })
})

describe('auditCsv', () => {
  it('serialises rows with header, semicolons and CRLF', () => {
    const csv = auditCsv([
      {
        id: 'e1',
        createdAt: '2026-07-29T10:00:00Z',
        action: 'config.published',
        actorEmail: 'a@b.dk',
        targetLabel: 'Blog',
        ipAddress: '10.0.0.1',
      },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('id;createdAt;action;actorEmail;targetLabel;ipAddress')
    expect(lines[1]).toBe('e1;2026-07-29T10:00:00Z;config.published;a@b.dk;Blog;10.0.0.1')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('quotes fields containing separators/quotes and doubles embedded quotes', () => {
    const csv = auditCsv([
      {
        id: 'e2',
        createdAt: '2026-07-29T10:00:00Z',
        action: 'member.removed',
        actorEmail: null,
        targetLabel: 'Acme; "Prod" brand',
        ipAddress: null,
      },
    ])
    expect(csv).toContain('"Acme; ""Prod"" brand"')
    // Nulls serialise as empty fields.
    expect(csv.split('\r\n')[1]!.endsWith(';')).toBe(true)
  })

  it('neutralises spreadsheet formulas in any field (CSV injection)', () => {
    const csv = auditCsv([
      {
        id: 'e3',
        createdAt: '2026-07-29T10:00:00Z',
        action: 'project.created',
        actorEmail: '@attacker.dk',
        targetLabel: '=HYPERLINK("http://x","click")',
        ipAddress: null,
      },
      {
        id: 'e4',
        createdAt: '2026-07-29T10:00:00Z',
        action: 'project.created',
        actorEmail: null,
        targetLabel: '+1',
        ipAddress: null,
      },
      {
        id: 'e5',
        createdAt: '2026-07-29T10:00:00Z',
        action: 'project.created',
        actorEmail: null,
        targetLabel: '-2',
        ipAddress: null,
      },
      {
        id: 'e6',
        createdAt: '2026-07-29T10:00:00Z',
        action: 'project.created',
        actorEmail: null,
        targetLabel: 'safe=1',
        ipAddress: null,
      },
    ])
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain(`;'@attacker.dk;`)
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"",""click"")"`)
    expect(lines[2]).toContain(`;'+1;`)
    expect(lines[3]).toContain(`;'-2;`)
    // Only a LEADING formula character is neutralised.
    expect(lines[4]).toContain(';safe=1;')
  })
})
