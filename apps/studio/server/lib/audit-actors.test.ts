import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
// The schema import chain reaches the db module, which needs a URL at import
// time; postgres.js does not connect until a query runs.
process.env.DATABASE_URL ??= 'postgres://unused@127.0.0.1:1/unused'
const { machineActorScope, machineKeyIds } = await import('./audit-actors')

const KEY_A = '11111111-1111-4111-8111-111111111111'
const KEY_B = '22222222-2222-4222-8222-222222222222'

describe('machineKeyIds', () => {
  it('takes the key id from machine:{uuid} actors and nothing else', () => {
    expect(
      machineKeyIds([
        `machine:${KEY_A}`,
        'user-123',
        null,
        `machine:${KEY_B}`,
        'machine:not-a-uuid',
      ]),
    ).toEqual([KEY_A, KEY_B])
  })

  it('returns each key once, however many rows it acted in', () => {
    expect(machineKeyIds([`machine:${KEY_A}`, `machine:${KEY_A}`])).toEqual([KEY_A])
  })

  it('returns nothing for a page of human and system rows', () => {
    expect(machineKeyIds(['user-1', null, 'user-2'])).toEqual([])
  })
})

describe('🔴 machineActorScope: a key is shown only inside its own org', () => {
  const render = () =>
    new PgDialect({ casing: 'snake_case' }).sqlToQuery(machineActorScope('org-a', [KEY_A]))

  it('matches the ids AND requires the org, directly or through a project', () => {
    const { sql, params } = render()
    expect(sql).toContain('"api_key"."id" in ($1)')
    expect(sql).toContain('"api_key"."organization_id" = $2')
    expect(sql).toContain('"project"."organization_id" = $3')
    expect(sql).toMatch(/^\(.* and \(.* or .*\)\)$/)
    expect(params).toEqual([KEY_A, 'org-a', 'org-a'])
  })
})
