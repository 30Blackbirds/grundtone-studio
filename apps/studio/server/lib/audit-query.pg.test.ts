import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The audit list's keyset cursor against a REAL Postgres (ClickUp 1amk32fn4t1).
// created_at keeps microseconds; the cursor used to be a JS Date, which keeps
// milliseconds, so rows sharing the last row's millisecond were skipped. Only a
// database shows which rows the cursor's WHERE selects.
//
// Same guard as the other *.pg / *.race suites: in CI a missing DATABASE_URL
// is a red run, not a silent skip. `test:coverage` excludes this file by name.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
type Schema = typeof import('~~/server/db/schema')
let db: Db
let schema: Schema
let query: typeof import('./audit-query')

const org = `audit-cursor-${randomUUID()}`

// Three rows inside ONE millisecond (…00.123xxx) and one older row. Ordered
// newest first they are a, b, c, d.
const STAMPS = {
  a: '2026-11-08T12:00:00.123900Z',
  b: '2026-11-08T12:00:00.123500Z',
  c: '2026-11-08T12:00:00.123100Z',
  d: '2026-11-08T12:00:00.100000Z',
} as const

async function page(before?: string, beforeId?: string, limit = 10) {
  return db
    .select({
      label: schema.auditLog.targetLabel,
      id: schema.auditLog.id,
      cursorAt: query.auditCursorAt,
    })
    .from(schema.auditLog)
    .where(and(...query.auditConditions({ orgId: org, before, beforeId })))
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(limit)
}

describe.skipIf(!DATABASE_URL)('audit list cursor (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    query = await import('./audit-query')
    for (const [label, at] of Object.entries(STAMPS)) {
      await db.insert(schema.auditLog).values({
        organizationId: org,
        action: 'config.published',
        targetLabel: label,
        createdAt: sql`${at}::timestamptz`,
      })
    }
  })

  afterAll(async () => {
    if (!db) return
    await db.delete(schema.auditLog).where(eq(schema.auditLog.organizationId, org))
    await db.$client.end()
  })

  it('reads the cursor timestamp with all six fractional digits', async () => {
    const [first] = await page(undefined, undefined, 1)
    expect(first!.label).toBe('a')
    expect(first!.cursorAt).toBe(STAMPS.a)
  })

  it('pages through rows that share one millisecond without losing any', async () => {
    const [first] = await page(undefined, undefined, 1)
    const rest = await page(first!.cursorAt, first!.id)
    expect(rest.map((r) => r.label)).toEqual(['b', 'c', 'd'])
  })

  // Control for the cell above: the same walk with the cursor cut to
  // milliseconds, which is what `createdAt.toISOString()` sent. If the fixture
  // ever stops putting rows in one millisecond, this fails and says so.
  it('loses the same-millisecond rows when the cursor is cut to milliseconds', async () => {
    const [first] = await page(undefined, undefined, 1)
    const millis = new Date(first!.cursorAt).toISOString()
    expect(millis).toBe('2026-11-08T12:00:00.123Z')
    const rest = await page(millis, first!.id)
    expect(rest.map((r) => r.label)).toEqual(['d'])
  })
})
