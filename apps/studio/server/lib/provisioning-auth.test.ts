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
let setHeaders: Record<string, unknown> = {}
vi.mock('h3', () => ({
  getRequestHeader: (_e: unknown, name: string) => headers[name],
  setHeader: (_e: unknown, name: string, value: unknown) => {
    setHeaders[name] = value
  },
  createError: (o: Record<string, unknown>) => Object.assign(new Error(String(o.statusMessage)), o),
}))

let rows: { id: string; organizationId: string | null; rateLimit?: number }[] = []
const wheres: unknown[] = []
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          wheres.push(w)
          // The schema default (1000) is filled in so the cells written before
          // the limit existed keep describing the same key. A cell that cares
          // sets it explicitly — and the `rateLimit: 1` cell below is what
          // proves the value really travels from the row into the limiter,
          // because a select that dropped the column would hand `check` an
          // undefined limit and every request would pass.
          return Promise.resolve(rows.map((r) => ({ rateLimit: 1000, ...r })))
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
    rateLimit: 'rateLimit',
  },
}))
vi.mock('./api-keys', () => ({ hashApiKey: (p: string) => `hash(${p})` }))

const used: string[] = []
vi.mock('./key-usage', () => ({
  recordKeyUse: (h: string) => {
    used.push(h)
  },
}))

// The plan gate (KH-964 AC-E). Its verdicts are measured in entitlements.test.ts;
// here only WHERE it sits: which org it is asked about, and that a refusal stops
// the key before it becomes a principal. `null` = the org may provision.
let gateRefusal: { statusCode: number; data: { code: string } } | null = null
const gateAsked: string[] = []
vi.mock('./entitlements', () => ({
  requireProvisioningFeature: (orgId: string) => {
    gateAsked.push(orgId)
    return gateRefusal
      ? Promise.reject(Object.assign(new Error('gate'), gateRefusal))
      : Promise.resolve()
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
  setHeaders = {}
  gateRefusal = null
  gateAsked.length = 0
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

describe('🔴 AC-F: the per-key rate limit is actually enforced', () => {
  // Before this, `api_key.rateLimit` was WRITTEN by five endpoints and READ for
  // enforcement by exactly one — the CDN route — and that route REFUSES
  // provisioning keys. So a provisioning key's stored limit bound nothing on
  // any path it could use, while `provisioning_key.created` recorded it in the
  // audit event as if it did.
  //
  // 🔴 EVERY CELL HERE USES ITS OWN KEY. The limiter is module-level, so its
  // buckets outlive a test. Giving each cell a distinct bearer (and therefore a
  // distinct hash) isolates them without reaching into the limiter's state —
  // and the isolation is itself part of what cell 3 measures.
  const present = (token: string) => {
    headers = { authorization: `Bearer prov_${token}` }
  }

  it('lets a request through while the key is under its limit', async () => {
    rows = [{ id: 'k1', organizationId: 'org-1', rateLimit: 5 }]
    present('under-limit')
    const e = event()
    await authenticateProvisioningKey(e)
    expect((e.context as Record<string, unknown>).provisioning).toMatchObject({ keyId: 'k1' })
  })

  it('refuses with 429, a distinguishable code, the limit, and Retry-After', async () => {
    rows = [{ id: 'k1', organizationId: 'org-1', rateLimit: 2 }]
    present('at-limit')
    await authenticateProvisioningKey(event())
    await authenticateProvisioningKey(event())
    await expect(authenticateProvisioningKey(event())).rejects.toMatchObject({
      statusCode: 429,
      data: { code: 'rate_limit_exceeded', limit: 2 },
    })
    // A 429 without Retry-After tells a machine to back off but not how far,
    // and a provisioning client is exactly the caller that will retry blind.
    expect(setHeaders['Retry-After']).toBeGreaterThan(0)
  })

  it('🔴 counts PER KEY, not globally — a global limiter would fail this', async () => {
    // The discriminating cell. A limiter keyed on anything shared (a constant,
    // the org, the route) passes every cell above and fails this one: one noisy
    // tenant would throttle every other tenant's provisioning.
    rows = [{ id: 'k1', organizationId: 'org-1', rateLimit: 1 }]
    present('noisy-neighbour')
    await authenticateProvisioningKey(event())
    await expect(authenticateProvisioningKey(event())).rejects.toMatchObject({ statusCode: 429 })

    // A different key, same org, same moment.
    rows = [{ id: 'k2', organizationId: 'org-1', rateLimit: 1 }]
    present('quiet-neighbour')
    const e = event()
    await authenticateProvisioningKey(e)
    expect((e.context as Record<string, unknown>).provisioning).toMatchObject({ keyId: 'k2' })
  })

  it('🔴 reads the limit from the ROW, not from a constant', async () => {
    // This is also what proves `rateLimit` survives the SELECT. A select that
    // dropped the column would hand `check` an undefined limit, every
    // comparison would be false, and this cell would pass a second call.
    rows = [{ id: 'k1', organizationId: 'org-1', rateLimit: 1 }]
    present('limit-of-one')
    await authenticateProvisioningKey(event())
    await expect(authenticateProvisioningKey(event())).rejects.toMatchObject({
      statusCode: 429,
      data: { limit: 1 },
    })
  })

  it('records the use even when the request is throttled', async () => {
    // Mirrors the CDN route, and for the same reason: a key being hammered past
    // its limit is a key IN USE, which is exactly what a leaked-key
    // investigation asks about (KH-987).
    rows = [{ id: 'k1', organizationId: 'org-1', rateLimit: 1 }]
    present('throttled-but-used')
    await authenticateProvisioningKey(event())
    used.length = 0
    await expect(authenticateProvisioningKey(event())).rejects.toMatchObject({ statusCode: 429 })
    expect(used).toEqual(['hash(prov_throttled-but-used)'])
  })
})

describe('🔴 AC-E: the plan gate sits at authentication', () => {
  // Distinct bearers per cell, like the AC-F block: the limiter outlives a test.
  const present = (token: string) => {
    headers = { authorization: `Bearer prov_gate_${token}` }
  }

  it("asks about the KEY'S org, not one from the request", async () => {
    rows = [{ id: 'k1', organizationId: 'org-of-key' }]
    present('gated')
    await authenticateProvisioningKey(event())
    expect(gateAsked).toEqual(['org-of-key'])
  })

  it.each([
    [403, 'feature_not_enabled'],
    [403, 'suspended'],
    [503, 'entitlements_unavailable'],
  ])(
    'a %i %s refusal propagates and the key never becomes a principal',
    async (statusCode, code) => {
      rows = [{ id: 'k1', organizationId: 'org-1' }]
      gateRefusal = { statusCode, data: { code } }
      present(`refused-${code}`)
      const e = event()
      await expect(authenticateProvisioningKey(e)).rejects.toMatchObject({
        statusCode,
        data: { code },
      })
      // Neither principal is set and no machine token is minted: the editor-gated
      // routes a key reaches through `auth` are closed too, not only the four
      // provisioning routes.
      expect(e.context.provisioning).toBeUndefined()
      expect(e.context.auth).toBeUndefined()
      expect(exchanges).toHaveLength(0)
    },
  )

  it('a throttled key does not reach the gate — the rate limit answers first', async () => {
    rows = [{ id: 'k1', organizationId: 'org-1', rateLimit: 1 }]
    present('throttled-before-gate')
    await authenticateProvisioningKey(event())
    await expect(authenticateProvisioningKey(event())).rejects.toMatchObject({ statusCode: 429 })
    expect(gateAsked).toHaveLength(1)
  })

  it('an unknown key does not reach the gate', async () => {
    rows = []
    present('unknown')
    await authenticateProvisioningKey(event())
    expect(gateAsked).toHaveLength(0)
  })
})
