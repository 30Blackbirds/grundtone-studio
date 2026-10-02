import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Cells for KH-964 AC-C1's minting half, and the AC-D boundaries it must keep.

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}))

let projectRows: Record<string, unknown>[] = []
const inserted: Record<string, unknown>[] = []
let selectWhere: unknown = null
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          selectWhere = w
          return Promise.resolve(projectRows)
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v)
        return {
          returning: () =>
            Promise.resolve([
              {
                id: 'key-9',
                keyPrefix: String(v.keyPrefix),
                keyType: String(v.keyType),
                environment: String(v.environment),
                allowedOrigins: v.allowedOrigins,
                rateLimit: v.rateLimit,
                createdAt: new Date(0),
              },
            ]),
        }
      },
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  apiKey: {},
  project: { id: 'id', name: 'name', organizationId: 'organizationId' },
}))

const audits: Record<string, unknown>[] = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, entry: Record<string, unknown>) => {
    audits.push(entry)
    return Promise.resolve()
  },
}))

const handler = (await import('./api-keys.post')).default as unknown as (
  e: ReturnType<typeof fakeEvent>,
) => Promise<Record<string, unknown>>

function call(opts: { orgId?: string; keyOrg?: string | null; body?: unknown } = {}) {
  const e = fakeEvent({
    params: { orgId: opts.orgId ?? 'org-1', projectId: 'p-1' },
    body: opts.body ?? {},
  })
  const keyOrg = opts.keyOrg === undefined ? 'org-1' : opts.keyOrg
  if (keyOrg !== null) {
    ;(e.context as Record<string, unknown>).provisioning = { keyId: 'k-1', organizationId: keyOrg }
  }
  return handler(e as never)
}

function conditions(): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (o.op === 'and') (o.a as unknown[]).forEach(walk)
    else if (o.op === 'eq') out.push(`eq:${String(o.col)}`)
  }
  walk(selectWhere)
  return out
}

beforeEach(() => {
  projectRows = [{ id: 'p-1', name: 'Acme' }]
  inserted.length = 0
  audits.length = 0
  selectWhere = null
})

describe('AC-C1: minting a pk_ key', () => {
  it('mints it for the project and returns the plaintext once', async () => {
    const res = await call()
    expect(String(res.plaintext)).toMatch(/^pk_live_[a-f0-9]{64}$/)
    expect(String(inserted[0]!.keyHash)).toMatch(/^[a-f0-9]{64}$/)
    expect(inserted[0]).not.toHaveProperty('plaintext')
  })

  it('🔴 mints ONLY publishable — the body cannot ask for a type', async () => {
    // Minting sk_ here would hand a project-editor machine principal to whoever
    // holds the provisioning key, outside the project-admin gate sk_ lives
    // behind. The request below tries; the stored type is what matters.
    const res = await call({ body: { keyType: 'secret' } })
    expect(res.keyType).toBe('publishable')
    expect(inserted[0]!.keyType).toBe('publishable')
    expect(String(res.plaintext).startsWith('pk_')).toBe(true)
  })

  it('attributes the key to the provisioning key, not to a person', async () => {
    await call()
    expect(inserted[0]!.createdBy).toBe('machine:k-1')
    expect(inserted[0]!.createdByEmail).toBeNull()
    expect(audits[0]).toMatchObject({ action: 'api_key.created', targetId: 'key-9' })
  })
})

describe('🔴 AC-D: the boundaries this endpoint must keep', () => {
  it('401s without a provisioning principal — a browser session cannot use it', async () => {
    await expect(call({ keyOrg: null })).rejects.toMatchObject({
      statusCode: 401,
      data: { code: 'provisioning_key_required' },
    })
    expect(inserted).toEqual([])
  })

  it("403s when the path org differs from the key's own org (AC-D1)", async () => {
    await expect(call({ orgId: 'org-2', keyOrg: 'org-1' })).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'wrong_organization' },
    })
    expect(inserted).toEqual([])
  })

  it("asks the PROJECT's own row which org it is in, not the path", async () => {
    await call()
    expect(conditions()).toEqual(expect.arrayContaining(['eq:id', 'eq:organizationId']))
  })

  it('🔴 404s — not 403 — for a project outside the org, so ids cannot be enumerated', async () => {
    // The discriminating choice: a 403 would confirm the id exists somewhere
    // else, which turns this endpoint into a cross-tenant id oracle.
    projectRows = []
    await expect(call()).rejects.toMatchObject({
      statusCode: 404,
      data: { code: 'project_not_found' },
    })
    expect(inserted).toEqual([])
    expect(audits).toEqual([])
  })
})

describe('body validation', () => {
  it.each([
    ['rate limit of zero', { rateLimit: 0 }],
    ['too many origins', { allowedOrigins: Array.from({ length: 21 }, () => 'a') }],
    ['an unknown environment', { environment: 'staging-ish' }],
  ])('%s is refused with 400 before anything is written', async (_l, body) => {
    await expect(call({ body })).rejects.toMatchObject({ statusCode: 400 })
    expect(inserted).toEqual([])
  })
})
