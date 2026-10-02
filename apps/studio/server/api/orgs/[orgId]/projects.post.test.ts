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
