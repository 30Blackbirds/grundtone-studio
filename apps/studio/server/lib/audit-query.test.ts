import { describe, expect, it } from 'vitest'
import { and } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
// audit-query imports server/lib/audit, which imports the db module; it needs a
// URL at import time, and postgres.js does not connect until a query runs.
process.env.DATABASE_URL ??= 'postgres://unused@127.0.0.1:1/unused'
const { auditConditions, auditFilterSchema, escapeLike } = await import('./audit-query')

// Same casing as server/db (drizzle({ casing: 'snake_case' })), so the SQL is
// what production sends.
const render = (f: Parameters<typeof auditConditions>[0]) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(and(...auditConditions(f))!)

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x')
    expect(escapeLike('plain')).toBe('plain')
  })
})

describe('auditConditions', () => {
  it('always scopes to the org, and only to the org without filters', () => {
    const { sql, params } = render({ orgId: 'o1' })
    expect(sql).toBe('"audit_log"."organization_id" = $1')
    expect(params).toEqual(['o1'])
  })

  it('searches the whole history server-side across email, target, action and IP', () => {
    const { sql, params } = render({ orgId: 'o1', q: '  colleague  ' })
    for (const col of ['actor_email', 'target_label', 'action', 'ip_address']) {
      expect(sql).toContain(`"audit_log"."${col}" ilike`)
    }
    expect(params.filter((p) => p === '%colleague%')).toHaveLength(4)
  })

  it('matches wildcards in the query literally', () => {
    const { params } = render({ orgId: 'o1', q: '100%' })
    expect(params).toContain('%100\\%%')
  })

  it('ORs in the actions whose translated label matched', () => {
    const { sql, params } = render({
      orgId: 'o1',
      q: 'Published',
      qActions: ['config.published', 'config.activated'],
    })
    expect(sql).toMatch(/"audit_log"\."action" in \(\$\d+, \$\d+\)/)
    expect(params).toEqual(expect.arrayContaining(['config.published', 'config.activated']))
  })

  it('ignores qActions without a query, and a blank query entirely', () => {
    expect(render({ orgId: 'o1', q: '   ', qActions: ['config.published'] }).params).toEqual(['o1'])
  })

  it('bounds the period from below', () => {
    const after = new Date('2026-09-10T00:00:00Z')
    const { sql, params } = render({ orgId: 'o1', after })
    expect(sql).toContain('"audit_log"."created_at" >= $2')
    expect(params[1]).toBe(after.toISOString())
  })

  it('keeps the composite cursor and passes its timestamp to Postgres as text', () => {
    const before = '2026-09-17T10:00:00.123456Z'
    const { sql, params } = render({
      orgId: 'o1',
      before,
      beforeId: '00000000-0000-4000-8000-000000000000',
    })
    expect(sql).toContain('"audit_log"."created_at" < $2::timestamptz')
    expect(sql).toContain('"audit_log"."id" < $4')
    // The microseconds reach the driver; a Date here would have dropped them.
    expect(params[1]).toBe(before)
  })
})

describe('auditFilterSchema', () => {
  it('splits and validates qActions against the known actions', () => {
    expect(
      auditFilterSchema.parse({ q: 'x', qActions: 'config.published,api_key.created' }).qActions,
    ).toEqual(['config.published', 'api_key.created'])
    expect(auditFilterSchema.safeParse({ qActions: 'config.published,nope.nope' }).success).toBe(
      false,
    )
  })

  it('caps the search length and requires ISO dates', () => {
    expect(auditFilterSchema.safeParse({ q: 'a'.repeat(201) }).success).toBe(false)
    expect(auditFilterSchema.safeParse({ after: 'yesterday' }).success).toBe(false)
    expect(auditFilterSchema.safeParse({ after: '2026-09-10T00:00:00Z' }).success).toBe(true)
  })

  it('accepts the microsecond cursor the list hands back', () => {
    expect(auditFilterSchema.parse({ before: '2026-11-08T12:00:00.123456Z' }).before).toBe(
      '2026-11-08T12:00:00.123456Z',
    )
  })
})
