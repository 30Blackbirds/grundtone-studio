import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Cells for KH-964 AC-B and the AC-D1 boundary.
//
// 🔴 WHAT THESE CELLS CANNOT MEASURE, so a green here is not read as more than
// it is: the IDEMPOTENCY ITSELF is the database's, via a partial unique index
// and ON CONFLICT DO NOTHING. A mock does not speak SQL. That half was measured
// against a real postgres and is recorded in the commit: two CONCURRENT inserts
// with the same externalRef left exactly one row, the loser got zero rows, and
// the same call repeated returned zero the second time. What is measured HERE is
// what the handler does with each of those outcomes.

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  sql: () => ({ op: 'sql' }),
}))

let insertRows: Record<string, unknown>[] = []
let insertThrows: unknown = null
let selectRows: Record<string, unknown>[] = []
let projectCount = 0
const deleted: unknown[] = []
vi.mock('~~/server/db', () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (insertThrows) return Promise.reject(insertThrows)
            return Promise.resolve(insertRows)
          },
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve(selectRows) }) }),
    $count: () => Promise.resolve(projectCount),
    delete: () => ({
      where: (w: unknown) => {
        deleted.push(w)
        return Promise.resolve()
      },
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  project: { id: 'id', organizationId: 'organizationId', externalRef: 'externalRef' },
}))

// 🔴 ONLY THE NETWORK CALL IS MOCKED. `evaluateProjectQuota` is the REAL one,
// imported through importOriginal, because it carries the contract's fail matrix
// (§4: lifecycle + limit). Mocking the evaluator would make these cells measure
// my own stub instead of the ruling they exist to pin.
let entitlements: Record<string, unknown> | null = null
vi.mock('~~/server/lib/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~~/server/lib/entitlements')>()),
  getStudioEntitlements: () => Promise.resolve(entitlements),
}))

const metrics: string[] = []
vi.mock('~~/server/lib/metrics', () => ({
  recordQuotaFailOpen: (k: string, r: string) => metrics.push(`failopen:${k}:${r}`),
  recordQuotaDenial: (k: string) => metrics.push(`denial:${k}`),
}))

function plan(over: Record<string, unknown> = {}) {
  return {
    planKey: 'studio-free',
    planState: 'active',
    graceUntil: null,
    features: [],
    limits: { 'studio.projects': 2 },
    asOf: '2026-10-03T00:00:00Z',
    ...over,
  }
}

let pdpThrows = false
const pdpCalls: string[] = []
vi.mock('~~/server/lib/pdp', () => ({
  linkProjectToOrg: (_e: unknown, p: string, o: string) => {
    pdpCalls.push(`link:${p}:${o}`)
    return pdpThrows ? Promise.reject(new Error('pdp down')) : Promise.resolve()
  },
  grantMachineProjectRole: (_e: unknown, p: string, k: string, role: string) => {
    pdpCalls.push(`grant:${p}:${k}:${role}`)
    return pdpThrows ? Promise.reject(new Error('pdp down')) : Promise.resolve()
  },
}))

const audits: Record<string, unknown>[] = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, entry: Record<string, unknown>) => {
    audits.push(entry)
    return Promise.resolve()
  },
}))

const handler = (await import('./projects.post')).default as unknown as (
  e: ReturnType<typeof fakeEvent>,
) => Promise<Record<string, unknown>>

const BODY = { name: 'Acme', slug: 'acme', externalRef: 'tenant-7' }
const PROJECT = { id: 'p-1', slug: 'acme', name: 'Acme', externalRef: 'tenant-7' }

function call(opts: { orgId?: string; keyOrg?: string | null; body?: unknown } = {}) {
  const e = fakeEvent({ params: { orgId: opts.orgId ?? 'org-1' }, body: opts.body ?? BODY })
  const keyOrg = opts.keyOrg === undefined ? 'org-1' : opts.keyOrg
  if (keyOrg !== null) {
    ;(e.context as Record<string, unknown>).provisioning = { keyId: 'k-1', organizationId: keyOrg }
  }
  return handler(e as never)
}

beforeEach(() => {
  insertRows = [PROJECT]
  insertThrows = null
  selectRows = []
  deleted.length = 0
  pdpThrows = false
  pdpCalls.length = 0
  audits.length = 0
  projectCount = 0
  entitlements = null
  metrics.length = 0
  delete process.env.ACCOUNT_URL
})

describe('AC-B1: creating a project', () => {
  it("creates it in the key's org and returns the id and externalRef", async () => {
    const res = await call()
    expect(res).toMatchObject({ id: 'p-1', externalRef: 'tenant-7' })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'project.created', targetId: 'p-1' })
  })

  it('🔴 grants the KEY editor, never admin (AC-D4)', async () => {
    // admin carries member management and key administration, which AC-D2
    // refuses to a provisioning key. editor is what writing tokens and
    // publishing needs, and nothing beyond it.
    await call()
    expect(pdpCalls).toEqual(['link:p-1:org-1', 'grant:p-1:k-1:editor'])
    expect(pdpCalls.join()).not.toContain('admin')
  })

  it('rolls the row back when the PDP write fails, so no orphan project survives', async () => {
    pdpThrows = true
    await expect(call()).rejects.toMatchObject({ statusCode: 502 })
    expect(deleted).toHaveLength(1)
    expect(audits).toEqual([])
  })
})

describe('AC-B2: a repeat is idempotent', () => {
  it('returns the existing project and writes NO new created event', async () => {
    // The database reported a conflict (zero rows inserted); the handler reads
    // the winner's row back. "No audit event" is the assertion that matters —
    // an audit trail that logs a creation per retry answers "how many projects
    // were created?" with the number of retries.
    insertRows = []
    selectRows = [PROJECT]
    const res = await call()
    expect(res).toMatchObject({ id: 'p-1' })
    expect(audits).toEqual([])
    expect(pdpCalls).toEqual([])
  })

  it('🔴 refuses rather than inventing a 200 when the conflict row cannot be read back', async () => {
    // A state this code cannot explain: the insert conflicted, so a row must
    // exist, and it does not. Returning 200 with nothing would be a plausible
    // wrong answer — the caller would believe it has a project.
    insertRows = []
    selectRows = []
    await expect(call()).rejects.toMatchObject({ statusCode: 500 })
  })
})

describe('AC-B4: a slug already taken under another reference', () => {
  it('is 409 with a distinguishable code, not a retryable-looking error', async () => {
    insertThrows = Object.assign(new Error('duplicate key'), { code: '23505' })
    await expect(call()).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'slug_taken' },
    })
    expect(audits).toEqual([])
  })

  it('recognises the violation when the driver nests it under cause', async () => {
    // postgres-js wraps; the bare code is not the only shape this arrives in,
    // and guessing one shape would turn a 409 into a 500.
    insertThrows = { message: 'dup', cause: { code: '23505' } }
    await expect(call()).rejects.toMatchObject({ statusCode: 409 })
  })

  it('does NOT swallow an unrelated database error as a slug conflict', async () => {
    // The discriminating case: a connection failure must not read as "pick
    // another slug".
    insertThrows = Object.assign(new Error('connection terminated'), { code: '08006' })
    await expect(call()).rejects.toMatchObject({ message: 'connection terminated' })
  })
})

describe('AC-D1: the key cannot act outside its own organisation', () => {
  it("🔴 403s when the path org differs from the key's org", async () => {
    // Never a silent redirect to the key's own org: answering the question that
    // was not asked is how a cross-tenant write looks reasonable in a log.
    await expect(call({ orgId: 'org-2', keyOrg: 'org-1' })).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'wrong_organization' },
    })
    expect(audits).toEqual([])
  })

  it('401s without a provisioning principal at all', async () => {
    await expect(call({ keyOrg: null })).rejects.toMatchObject({
      statusCode: 401,
      data: { code: 'provisioning_key_required' },
    })
  })
})

describe('body validation', () => {
  it.each([
    ['missing externalRef', { name: 'A', slug: 'a' }],
    ['empty externalRef', { name: 'A', slug: 'a', externalRef: '' }],
    ['slug with uppercase', { name: 'A', slug: 'Acme', externalRef: 'r' }],
    ['slug with a slash', { name: 'A', slug: 'a/b', externalRef: 'r' }],
  ])('%s is refused with 400, before anything is written', async (_l, body) => {
    await expect(call({ body })).rejects.toMatchObject({ statusCode: 400 })
    expect(audits).toEqual([])
    expect(pdpCalls).toEqual([])
  })
})

describe('🔴 AC-E: the project quota applies to the machine path too (869fbg1x4)', () => {
  // The hole this block closes: the human endpoint enforced the free-tier quota
  // and this one did not, so a provisioning key could create projects without
  // limit. Measured with a positive control — the search that found 15
  // entitlement references in api/projects.post.ts found 0 here.

  it('creates normally while the org is under its limit', async () => {
    entitlements = plan({ limits: { 'studio.projects': 2 } })
    projectCount = 1
    await expect(call()).resolves.toMatchObject({ id: 'p-1' })
    expect(metrics).toEqual([])
  })

  it('refuses at the limit with a distinguishable code AND the limit', async () => {
    entitlements = plan({ limits: { 'studio.projects': 2 } })
    projectCount = 2
    await expect(call()).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'quota_exceeded', limit: 2, planKey: 'studio-free' },
    })
    expect(metrics).toEqual(['denial:studio.projects'])
  })

  it('refuses a suspended org, and does NOT count that as a quota denial', async () => {
    // Suspension is a governance decision, not an outage, and not a quota
    // event. Counting it would inflate the denial series with something the
    // limit had no say in.
    entitlements = plan({ planState: 'suspended' })
    projectCount = 0
    await expect(call()).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'suspended' },
    })
    expect(metrics).toEqual([])
  })

  it('🔴 FAILS OPEN when entitlements are unavailable — the contract says so', async () => {
    // §4 of STUDIO-KVOTE-ENTITLEMENTS-KONTRAKT.md is a FINAL ruling: a quota
    // gate never blocks on infrastructure failure, because the lockout
    // prohibition wins. This cell exists so nobody "hardens" it into
    // fail-closed without reopening the contract. My own instinct was
    // fail-closed; this is what overruled it.
    process.env.ACCOUNT_URL = 'http://account.invalid'
    entitlements = null
    projectCount = 99
    await expect(call()).resolves.toMatchObject({ id: 'p-1' })
    expect(metrics).toEqual(['failopen:studio.projects:entitlements_unavailable'])
  })

  it('does not raise the fail-open alarm when entitlements are simply unconfigured', async () => {
    // Both states return null. Only "configured but unreachable" is a true
    // unavailability; counting the dormant state would false-alarm the series
    // every single request in any deployment without billing.
    entitlements = null
    projectCount = 99
    await expect(call()).resolves.toMatchObject({ id: 'p-1' })
    expect(metrics).toEqual([])
  })

  it('🔴 an idempotent retry still succeeds at the limit — the quota gates CREATION', async () => {
    // AC-B3 promises both callers a success with the same id. If the org
    // crossed its limit between the first call and the retry, a 403 on the
    // retry would break that promise and leave the caller unable to learn that
    // its project exists. Nothing is created here, so nothing is gated.
    entitlements = plan({ limits: { 'studio.projects': 2 } })
    projectCount = 5
    selectRows = [PROJECT]
    await expect(call()).resolves.toMatchObject({ id: 'p-1', externalRef: 'tenant-7' })
    expect(audits).toHaveLength(0)
    expect(metrics).toEqual([])
  })
})
