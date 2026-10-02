import { describe, it, expect, vi, beforeEach } from 'vitest'

// Cells for KH-964 AC-A3. The criterion is about the NEXT request after a
// revoke, so what is measured here is that the lookup happens per request and
// that `revokedAt` is part of it.

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
}))

let headers: Record<string, string> = {}
vi.mock('h3', () => ({
  getRequestHeader: (_e: unknown, name: string) => headers[name],
}))

let rows: { id: string; organizationId: string | null }[] = []
const wheres: unknown[] = []
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          wheres.push(w)
          return Promise.resolve(rows)
        },
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  apiKey: {
    id: 'id',
    organizationId: 'organizationId',
    keyHash: 'keyHash',
    keyType: 'keyType',
    revokedAt: 'revokedAt',
  },
}))
vi.mock('./api-keys', () => ({ hashApiKey: (p: string) => `hash(${p})` }))

const used: string[] = []
vi.mock('./key-usage', () => ({
  recordKeyUse: (h: string) => {
    used.push(h)
  },
}))

let exchange: 'ok' | 'fail' = 'ok'
const exchanges: Record<string, unknown>[] = []
vi.stubGlobal('$fetch', (_url: string, opts: { body: Record<string, unknown> }) => {
  exchanges.push(opts.body)
  return exchange === 'ok'
    ? Promise.resolve({ token: 'jwt-1' })
    : Promise.reject(new Error('auth down'))
})

const { authenticateProvisioningKey } = await import('./provisioning-auth')
const event = () =>
  ({ context: {} }) as unknown as Parameters<typeof authenticateProvisioningKey>[0]

/** Every leaf condition the query was built with, flattened. */
function conditions(): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (o.op === 'and') (o.a as unknown[]).forEach(walk)
    else if (o.op === 'eq') out.push(`eq:${String(o.col)}`)
    else if (o.op === 'isNull') out.push(`isNull:${String(o.col)}`)
  }
  wheres.forEach(walk)
  return out
}

beforeEach(() => {
  headers = {}
  rows = []
  wheres.length = 0
  used.length = 0
  exchange = 'ok'
  exchanges.length = 0
  process.env.AUTH_INTERNAL_URL = 'http://auth:3000'
  process.env.MACHINE_TOKEN_SERVICE_SECRET = 's3cret'
})

describe('does nothing without a prov_ bearer', () => {
  it.each([
    ['a browser session token', 'Bearer eyJhbGciOi.session'],
    ['a project secret key', 'Bearer sk_live_abc'],
    ['a publishable key', 'Bearer pk_live_abc'],
    ['no header at all', undefined],
  ])('%s: no query, no principal', async (_label, header) => {
    // The hot-path guarantee: CDN, browser and sk_ traffic must not pay for a
    // query they cannot use.
    if (header) headers.authorization = header
    const e = event()
    await authenticateProvisioningKey(e)
    expect(wheres).toEqual([])
    expect(e.context.provisioning).toBeUndefined()
  })
})

describe('🔴 AC-A3: revocation takes effect on the NEXT request', () => {
  it('asks the database on EVERY call — nothing is cached', async () => {
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    await authenticateProvisioningKey(event())
    await authenticateProvisioningKey(event())
    await authenticateProvisioningKey(event())
    // Three calls, three queries. A cache here would satisfy every other cell
    // in this file and break the criterion, so the count IS the assertion.
    expect(wheres).toHaveLength(3)
  })

  // 🔴 MEASURED BY MUTATION, so the division of labour is written down rather
  // than assumed: removing `isNull(revokedAt)` from the query kills the
  // CONDITION cell below and NOT this one, because this mock returns an empty
  // result whatever the query asked. This cell measures the handler's reaction
  // to "no row"; the condition cell measures that the query is what produces
  // it. Reading either as covering both would leave half of AC-A3 unmeasured.
  it('a revoked key is refused on the very next call', async () => {
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    const first = event()
    await authenticateProvisioningKey(first)
    expect(first.context.provisioning).toEqual({ keyId: 'k1', organizationId: 'org-1' })

    // The revoke endpoint stamps revokedAt; the query stops matching.
    rows = []
    const next = event()
    await authenticateProvisioningKey(next)
    expect(next.context.provisioning).toBeUndefined()
  })

  it('carries isNull(revokedAt) in the query, not as a check on a cached row', () => {
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    return authenticateProvisioningKey(event()).then(() => {
      expect(conditions()).toContain('isNull:revokedAt')
    })
  })
})

describe('what the query narrows on', () => {
  it('🔴 narrows on keyType, so a pk_/sk_ hash cannot authenticate here', async () => {
    // Without this, any valid project key would be accepted as a provisioning
    // principal — a privilege escalation from one project to a whole org.
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    await authenticateProvisioningKey(event())
    expect(conditions()).toContain('eq:keyType')
  })

  it('refuses a row whose organizationId is null rather than narrowing it', async () => {
    // The check constraint should make this unreachable. If it is ever reached,
    // the answer must be "no" — not a principal with an undefined tenant.
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: null }]
    const e = event()
    await authenticateProvisioningKey(e)
    expect(e.context.provisioning).toBeUndefined()
  })
})

describe('usage signal', () => {
  it('records the use of an accepted key, by hash', async () => {
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    await authenticateProvisioningKey(event())
    expect(used).toEqual(['hash(prov_live_abc)'])
  })

  it('does NOT record a use for an unknown or revoked key', async () => {
    headers.authorization = 'Bearer prov_live_nope'
    rows = []
    await authenticateProvisioningKey(event())
    expect(used).toEqual([])
  })
})

describe('🔴 the machine principal — added after the first cells, and they did not see it', () => {
  // These cells exist because the first eleven passed WITHOUT them while the
  // exchange was unmeasured: the test environment had no AUTH_INTERNAL_URL, so
  // the function returned before reaching it. A green suite over a code path
  // nothing drives is the capability-without-a-cell state.

  it('presents the key to the PDP as machine:{keyId} with the org as tenant', async () => {
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    const e = event()
    await authenticateProvisioningKey(e)
    expect(e.context.auth).toEqual({ sub: 'machine:k1', tenant: 'org-1' })
    expect(e.context.authToken).toBe('jwt-1')
    // The exchange is keyed on the KEY, not on a project — which is why the
    // same shape works for an org-scoped key.
    expect(exchanges[0]).toEqual({ keyId: 'k1', org: 'org-1' })
  })

  it('mints per request and never reuses a token', async () => {
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    await authenticateProvisioningKey(event())
    await authenticateProvisioningKey(event())
    // Two requests, two exchanges. A token kept between requests would make the
    // token's own lifetime part of revocation, which AC-A3 forbids.
    expect(exchanges).toHaveLength(2)
  })

  it('🔴 leaves auth unset when the exchange fails — but the use IS recorded', async () => {
    // Fail closed on authority, honest on usage: the key was presented and
    // accepted, so "was this key used?" must answer yes even though the request
    // will 401.
    exchange = 'fail'
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    const e = event()
    await authenticateProvisioningKey(e)
    expect(e.context.auth).toBeUndefined()
    expect(e.context.provisioning).toEqual({ keyId: 'k1', organizationId: 'org-1' })
    expect(used).toEqual(['hash(prov_live_abc)'])
  })

  it('does not attempt an exchange when it is not configured', async () => {
    delete process.env.AUTH_INTERNAL_URL
    delete process.env.AUTH_ISSUER
    headers.authorization = 'Bearer prov_live_abc'
    rows = [{ id: 'k1', organizationId: 'org-1' }]
    const e = event()
    await authenticateProvisioningKey(e)
    expect(exchanges).toEqual([])
    expect(e.context.auth).toBeUndefined()
  })
})
