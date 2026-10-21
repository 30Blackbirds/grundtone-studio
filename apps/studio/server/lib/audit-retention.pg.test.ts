import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The audit_log retention against a REAL Postgres: constructed rows on both
// sides of each deadline, so the run shows it removes what is past the cut AND
// keeps what is not. Only a database shows what the WHERE clauses select.
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
let retention: typeof import('./audit-retention')

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date()
const org = `retention-${randomUUID()}`
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

async function row(label: string, createdAt: Date): Promise<string> {
  const [r] = await db
    .insert(schema.auditLog)
    .values({
      organizationId: org,
      action: 'config.published',
      targetLabel: label,
      ipAddress: '203.0.113.7',
      userAgent: 'retention-test',
      createdAt,
    })
    .returning({ id: schema.auditLog.id })
  return r!.id
}

async function read(id: string) {
  const [r] = await db
    .select({ ip: schema.auditLog.ipAddress, ua: schema.auditLog.userAgent })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.id, id))
  return r ?? null
}

describe.skipIf(!DATABASE_URL)('applyAuditRetention (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    retention = await import('./audit-retention')
  })

  afterAll(async () => {
    if (!db) return
    await db.delete(schema.auditLog).where(eq(schema.auditLog.organizationId, org))
    await db.$client.end()
  })

  it('strips past 89 days, deletes past 12 months − 1 day, and keeps the rest', async () => {
    const fresh = await row('fresh', ago(10))
    const justInside = await row('88 days', ago(88))
    const pastStrip = await row('95 days', ago(95))
    const oldButKept = await row('360 days', ago(360))
    const pastDelete = await row('370 days', ago(370))

    const result = await retention.applyAuditRetention(NOW)

    // Kept with IP/UA: inside the strip cut-off.
    expect(await read(fresh)).toEqual({ ip: '203.0.113.7', ua: 'retention-test' })
    expect(await read(justInside)).toEqual({ ip: '203.0.113.7', ua: 'retention-test' })
    // Positive control for the strip: the row stays, its IP/UA does not.
    expect(await read(pastStrip)).toEqual({ ip: null, ua: null })
    expect(await read(oldButKept)).toEqual({ ip: null, ua: null })
    // Positive control for the delete.
    expect(await read(pastDelete)).toBeNull()

    expect(result.stripped).toBeGreaterThanOrEqual(2)
    expect(result.deleted).toBeGreaterThanOrEqual(1)

    // The measurement the acceptance criterion names, taken after the run.
    const ages = await retention.retentionAges()
    expect(ages.maxAgeWithIpUaDays).not.toBeNull()
    expect(ages.maxAgeWithIpUaDays!).toBeLessThanOrEqual(90)
    expect(ages.maxAgeDays!).toBeLessThanOrEqual(366)
  })

  it('is idempotent: a second run right after touches nothing', async () => {
    const again = await retention.applyAuditRetention(NOW)
    expect(again).toMatchObject({ stripped: 0, deleted: 0 })
  })
})
