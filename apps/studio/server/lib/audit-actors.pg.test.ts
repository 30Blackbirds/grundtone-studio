import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// resolveMachineActors against a REAL Postgres (KH-964, AC-G1). The org scope
// is a join plus an OR, and only a database can show that a key from ANOTHER
// org is actually left out — a rendered-SQL cell shows the condition exists,
// not what it selects.
//
// Same guard as brand-quota.race.test.ts: in CI a missing DATABASE_URL is a red
// run, not a silent skip. `test:coverage` excludes `*.pg.test.ts` by name.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
type Schema = typeof import('~~/server/db/schema')
let db: Db
let schema: Schema
let resolveMachineActors: typeof import('./audit-actors').resolveMachineActors

const orgA = `org-a-${randomUUID()}`
const orgB = `org-b-${randomUUID()}`
const keyIds: string[] = []
const projectIds: string[] = []

async function insertKey(values: {
  organizationId?: string
  projectId?: string
  keyType: string
  keyPrefix: string
}): Promise<string> {
  const [row] = await db
    .insert(schema.apiKey)
    .values({ ...values, keyHash: randomUUID(), createdBy: 'audit-actors-test' })
    .returning({ id: schema.apiKey.id })
  keyIds.push(row!.id)
  return row!.id
}

describe.skipIf(!DATABASE_URL)('resolveMachineActors (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    ;({ resolveMachineActors } = await import('./audit-actors'))
  })

  afterAll(async () => {
    if (!db) return
    await db.delete(schema.apiKey).where(inArray(schema.apiKey.id, keyIds))
    if (projectIds.length) {
      await db.delete(schema.project).where(inArray(schema.project.id, projectIds))
    }
    await db.$client.end()
  })

  it('names org A keys, direct and via a project, and leaves out org B', async () => {
    const [projectA] = await db
      .insert(schema.project)
      .values({ organizationId: orgA, name: 'A', slug: `a-${randomUUID()}` })
      .returning({ id: schema.project.id })
    projectIds.push(projectA!.id)

    const provA = await insertKey({
      organizationId: orgA,
      keyType: 'provisioning',
      keyPrefix: 'prov_aaaa',
    })
    const skA = await insertKey({
      projectId: projectA!.id,
      keyType: 'secret',
      keyPrefix: 'sk_aaaa',
    })
    const provB = await insertKey({
      organizationId: orgB,
      keyType: 'provisioning',
      keyPrefix: 'prov_bbbb',
    })

    const resolved = await resolveMachineActors(orgA, [
      `machine:${provA}`,
      `machine:${skA}`,
      `machine:${provB}`,
      'user-1',
    ])

    // Positive control: both of org A's keys resolve, through both branches.
    expect(resolved.get(`machine:${provA}`)).toEqual({
      keyPrefix: 'prov_aaaa',
      keyType: 'provisioning',
    })
    expect(resolved.get(`machine:${skA}`)).toEqual({ keyPrefix: 'sk_aaaa', keyType: 'secret' })
    // The property under test: org B's key does not leak onto org A's page.
    expect(resolved.has(`machine:${provB}`)).toBe(false)
    expect(resolved.size).toBe(2)

    // And org B sees its own key — the exclusion above is the scope, not a broken lookup.
    expect(
      (await resolveMachineActors(orgB, [`machine:${provB}`])).get(`machine:${provB}`),
    ).toEqual({
      keyPrefix: 'prov_bbbb',
      keyType: 'provisioning',
    })
  })
})
