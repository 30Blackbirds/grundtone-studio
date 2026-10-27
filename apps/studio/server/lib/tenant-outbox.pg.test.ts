import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The outbox against a REAL Postgres: what the partial unique index collapses,
// what the lease lets two deliverers do, and what each account answer leaves in
// the row. Only a database shows what ON CONFLICT and SKIP LOCKED actually do.
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
let outbox: typeof import('./tenant-outbox')

const orgs: string[] = []
const newOrg = () => {
  const id = `outbox-${randomUUID()}`
  orgs.push(id)
  return id
}

async function rowsFor(orgId: string) {
  return db
    .select()
    .from(schema.tenantEventOutbox)
    .where(eq(schema.tenantEventOutbox.organizationId, orgId))
}

/** A fake account ingest: answers with `status`/`body` and records each event. */
function fakeAccount(status: number, body: unknown) {
  const sent: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn(
    async (url: string, init: { body: string; headers: Record<string, string> }) => {
      expect(url).toBe(`http://account.test${outbox.PUBLISH_PATH}`)
      expect(init.headers.authorization).toBe('Bearer ingest-token')
      sent.push((JSON.parse(init.body) as { event: Record<string, unknown> }).event)
      return new Response(JSON.stringify(body), { status })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return sent
}

describe.skipIf(!DATABASE_URL)('tenant outbox (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    outbox = await import('./tenant-outbox')
  })

  beforeEach(() => {
    process.env.ACCOUNT_URL = 'http://account.test'
    process.env.ACCOUNT_INGEST_TOKEN = 'ingest-token'
    outbox.resetKnownOrgs()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ACCOUNT_URL
    delete process.env.ACCOUNT_INGEST_TOKEN
  })

  afterAll(async () => {
    if (!db) return
    if (orgs.length > 0) {
      await db
        .delete(schema.tenantEventOutbox)
        .where(inArray(schema.tenantEventOutbox.organizationId, orgs))
      await db.delete(schema.project).where(inArray(schema.project.organizationId, orgs))
    }
    await db.$client.end()
  })

  describe('enqueue', () => {
    it('queues one tenantProvisioned whose id is its idempotencyKey', async () => {
      const org = newOrg()
      expect(await outbox.enqueueTenantProvisioned({ id: org, slug: 'acme' })).toBe(true)
      const [row] = await rowsFor(org)
      expect(row!.eventType).toBe('tenantProvisioned')
      expect(row!.event.idempotencyKey).toBe(row!.id)
    })

    it('🔴 a second enqueue for the same org is a no-op — one row, the first key', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org })
      const [first] = await rowsFor(org)
      expect(await outbox.enqueueTenantProvisioned({ id: org })).toBe(false)
      const rows = await rowsFor(org)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(first!.id)
    })

    it('🔴 ten concurrent enqueues (replicas, tabs) still leave exactly one row', async () => {
      const org = newOrg()
      const results = await Promise.all(
        Array.from({ length: 10 }, () => outbox.enqueueTenantProvisioned({ id: org })),
      )
      expect(results.filter(Boolean)).toHaveLength(1)
      expect(await rowsFor(org)).toHaveLength(1)
    })

    it("provisionedAt is the org's earliest evidence, not the enqueue time (§3)", async () => {
      const org = newOrg()
      await db.insert(schema.project).values({
        organizationId: org,
        slug: `p-${randomUUID()}`,
        name: 'old brand',
        createdAt: new Date('2025-01-15T00:00:00Z'),
      })
      await outbox.enqueueTenantProvisioned(
        { id: org, createdAt: '2025-06-01T00:00:00Z' },
        new Date('2026-12-01T00:00:00Z'),
      )
      const [row] = await rowsFor(org)
      const payload = row!.event.tenantProvisioned as { provisionedAt: string }
      expect(payload.provisionedAt).toBe('2025-01-15T00:00:00.000Z')
      expect(row!.event.occurredAt).toBe('2026-12-01T00:00:00.000Z')
    })

    it('knownOrgIds finds an org Studio only has a project for', async () => {
      const org = newOrg()
      await db
        .insert(schema.project)
        .values({ organizationId: org, slug: `p-${randomUUID()}`, name: 'b' })
      expect(await outbox.knownOrgIds()).toContain(org)
    })
  })

  describe('deliverDue', () => {
    it('200 accepted → delivered, and the event account got is the stored one', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org, slug: 'acme' })
      const sent = fakeAccount(200, { accepted: true })
      const result = await outbox.deliverDue({ organizationId: org })
      expect(result).toMatchObject({ delivered: 1, retried: 0, parked: 0 })
      const [row] = await rowsFor(org)
      expect(row!.deliveredAt).not.toBeNull()
      expect(sent).toEqual([row!.event])
      expect(await outbox.isTenantProvisioned(org)).toBe(true)
    })

    it('a delivered row is never sent again', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org })
      fakeAccount(200, { accepted: true })
      await outbox.deliverDue({ organizationId: org })
      const sent = fakeAccount(200, { accepted: true })
      await outbox.deliverDue({ organizationId: org, now: new Date(Date.now() + 86_400_000) })
      expect(sent).toHaveLength(0)
    })

    it('🔴 400 parks the row: not delivered, never due again', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      fakeAccount(400, { code: 'invalid_argument', message: 'x' })
      expect(await outbox.deliverDue({ organizationId: org })).toMatchObject({ parked: 1 })
      const [row] = await rowsFor(org)
      expect(row!.parkedAt).not.toBeNull()
      expect(row!.deliveredAt).toBeNull()
      const later = fakeAccount(200, { accepted: true })
      await outbox.deliverDue({ organizationId: org, now: new Date(Date.now() + 86_400_000) })
      expect(later).toHaveLength(0)
      expect(await outbox.isTenantProvisioned(org)).toBe(false)
    })

    it('503 keeps the row with a backoff, and it is sent again once due', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org })
      fakeAccount(503, { code: 'unavailable' })
      expect(await outbox.deliverDue({ organizationId: org })).toMatchObject({ retried: 1 })
      const [row] = await rowsFor(org)
      expect(row!.attempts).toBe(1)
      expect(row!.lastError).toContain('503')
      expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())

      const notYet = fakeAccount(200, { accepted: true })
      await outbox.deliverDue({ organizationId: org })
      expect(notYet).toHaveLength(0)

      const due = fakeAccount(200, { duplicate: true })
      await outbox.deliverDue({ organizationId: org, now: new Date(Date.now() + 86_400_000) })
      expect(due).toHaveLength(1)
      // Same idempotency key on the retry: that is what lets account dedup.
      expect(due[0]!.idempotencyKey).toBe(row!.id)
      expect(await outbox.isTenantProvisioned(org)).toBe(true)
    })

    it('a transport failure is a retry, not a loss', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org })
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
      )
      expect(await outbox.deliverDue({ organizationId: org })).toMatchObject({ retried: 1 })
      const [row] = await rowsFor(org)
      expect(row!.lastError).toContain('ECONNREFUSED')
      expect(row!.deliveredAt).toBeNull()
    })

    it('dormant without ACCOUNT_INGEST_TOKEN: nothing sent, the row waits', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org })
      delete process.env.ACCOUNT_INGEST_TOKEN
      const sent = fakeAccount(200, { accepted: true })
      expect(await outbox.deliverDue({ organizationId: org })).toMatchObject({ dormant: true })
      expect(sent).toHaveLength(0)
      const [row] = await rowsFor(org)
      expect(row!.attempts).toBe(0)
    })

    it('🔴 two concurrent deliverers send each row exactly once (the lease)', async () => {
      const org = newOrg()
      await outbox.enqueueTenantProvisioned({ id: org })
      let release!: () => void
      const held = new Promise<void>((r) => (release = r))
      let calls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          calls++
          await held
          return new Response(JSON.stringify({ accepted: true }), { status: 200 })
        }),
      )
      const first = outbox.deliverDue({ organizationId: org })
      // Let the first claim land before the second looks.
      await new Promise((r) => setTimeout(r, 100))
      const second = await outbox.deliverDue({ organizationId: org })
      release()
      await first
      expect(second).toMatchObject({ delivered: 0, retried: 0 })
      expect(calls).toBe(1)
    })
  })

  describe('provisionNow (checkout)', () => {
    it('queues and delivers in one call', async () => {
      const org = newOrg()
      fakeAccount(200, { accepted: true })
      expect(await outbox.provisionNow({ id: org, slug: 'acme' })).toBe(true)
    })

    it('reports false when account did not take it', async () => {
      const org = newOrg()
      fakeAccount(503, { code: 'unavailable' })
      expect(await outbox.provisionNow({ id: org })).toBe(false)
    })

    it('does not resend for an org that is already provisioned', async () => {
      const org = newOrg()
      fakeAccount(200, { accepted: true })
      await outbox.provisionNow({ id: org })
      const sent = fakeAccount(200, { accepted: true })
      expect(await outbox.provisionNow({ id: org })).toBe(true)
      expect(sent).toHaveLength(0)
    })
  })

  describe('ensureTenantProvisioned (the first-use hook)', () => {
    it('never throws, and does not remember an org it failed to queue', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const insert = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
        throw new Error('db down')
      })
      const org = newOrg()
      await expect(outbox.ensureTenantProvisioned({ id: org })).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalled()
      insert.mockRestore()
      await outbox.ensureTenantProvisioned({ id: org })
      expect(await rowsFor(org)).toHaveLength(1)
    })
  })
})
