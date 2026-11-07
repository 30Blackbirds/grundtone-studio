import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// orgsWithBrands against a REAL Postgres: the reconcile's population is the
// orgs with at least one active_version, and only the join shows that.
// Same guard as the other *.pg suites; `test:coverage` excludes it by name.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let brandCount: typeof import('./brand-count')
const withBrand = `bc-${randomUUID()}`
const withoutBrand = `bc-${randomUUID()}`

describe.skipIf(!DATABASE_URL)('orgsWithBrands (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    brandCount = await import('./brand-count')
    for (const org of [withBrand, withoutBrand]) {
      const [p] = await db
        .insert(schema.project)
        .values({ organizationId: org, slug: `p-${randomUUID()}`, name: 'b' })
        .returning({ id: schema.project.id })
      if (org !== withBrand) continue
      const [v] = await db
        .insert(schema.configVersion)
        .values({ projectId: p!.id, version: 1, status: 'published', tokensJson: {} })
        .returning({ id: schema.configVersion.id })
      await db
        .insert(schema.activeVersion)
        .values({ projectId: p!.id, configVersionId: v!.id, activatedBy: 'u' })
    }
  })

  afterAll(async () => {
    if (!db) return
    await db
      .delete(schema.project)
      .where(inArray(schema.project.organizationId, [withBrand, withoutBrand]))
    await db.$client.end()
  })

  it('lists an org with an active brand, and not one that only has a draft project', async () => {
    const orgs = await brandCount.orgsWithBrands()
    expect(orgs).toContain(withBrand)
    expect(orgs).not.toContain(withoutBrand)
  })

  it('counts that org as one brand', async () => {
    expect(await brandCount.currentBrandCount(withBrand)).toBe(1)
    expect(await brandCount.currentBrandCount(withoutBrand)).toBe(0)
  })
})
