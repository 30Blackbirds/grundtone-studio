import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The org_member table's own guarantees, against a REAL Postgres: the unique
// index and the role check only exist there. Same guard as the other *.pg
// suites; `test:coverage` excludes it by name.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')

const org = `om-${randomUUID()}`

describe.skipIf(!DATABASE_URL)('org_member (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
  })

  afterAll(async () => {
    if (!db) return
    await db.delete(schema.orgMember).where(eq(schema.orgMember.organizationId, org))
    await db.$client.end()
  })

  it('stores every role studio knows', async () => {
    const roles = ['owner', 'manager', 'admin', 'member', 'billing']
    await db
      .insert(schema.orgMember)
      .values(roles.map((role, i) => ({ organizationId: org, userId: `u-${i}`, role })))
    const rows = await db
      .select({ role: schema.orgMember.role })
      .from(schema.orgMember)
      .where(eq(schema.orgMember.organizationId, org))
    expect(rows.map((r) => r.role).sort()).toEqual([...roles].sort())
  })

  // One role per (org, user): a second row would make "which role holds" a
  // question with two answers.
  it('refuses a second row for the same org and user', async () => {
    await expect(
      db.insert(schema.orgMember).values({ organizationId: org, userId: 'u-0', role: 'member' }),
    ).rejects.toThrow()
  })

  it('refuses a role nothing knows', async () => {
    await expect(
      db.insert(schema.orgMember).values({ organizationId: org, userId: 'u-x', role: 'root' }),
    ).rejects.toThrow()
  })
})
