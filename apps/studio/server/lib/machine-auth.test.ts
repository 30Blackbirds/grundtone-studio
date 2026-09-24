import { describe, it, expect, vi, beforeEach } from 'vitest'

// 🔴 machine-auth.ts had NO cells before this file (KH-987). These cover the
// usage signal added there and, with it, the module's basic contract — a whole
// authentication path with no cells is worth naming, not quietly leaving.

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
}))

let headers: Record<string, string> = {}
vi.mock('h3', () => ({
  getRequestHeader: (_event: unknown, name: string) => headers[name],
}))

let nextRows: { id: string; projectId: string; organizationId: string | null }[] = []
let dbCalls = 0
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => {
            dbCalls++
            return Promise.resolve(nextRows)
          },
        }),
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  apiKey: {
    id: 'id',
    projectId: 'projectId',
    keyHash: 'keyHash',
    keyType: 'keyType',
    revokedAt: 'revokedAt',
  },
  project: { id: 'pid', organizationId: 'organizationId' },
}))
vi.mock('./api-keys', () => ({ hashApiKey: (plain: string) => `hash(${plain})` }))

const recorded: string[] = []
vi.mock('./key-usage', () => ({
  recordKeyUse: (hash: string) => {
    recorded.push(hash)
  },
}))

let exchangeOk = true
vi.stubGlobal('$fetch', () =>
  exchangeOk ? Promise.resolve({ token: 'jwt' }) : Promise.reject(new Error('auth down')),
)

const { authenticateMachineKey } = await import('./machine-auth')

const event = () => ({ context: {} }) as unknown as Parameters<typeof authenticateMachineKey>[0]

beforeEach(() => {
  headers = {}
  nextRows = []
  recorded.length = 0
  dbCalls = 0
  exchangeOk = true
  process.env.AUTH_INTERNAL_URL = 'http://auth:3000'
  process.env.MACHINE_TOKEN_SERVICE_SECRET = 's3cret'
})

describe('authenticateMachineKey', () => {
  it('does nothing at all without an sk_ bearer — not even a query', async () => {
    // The hot-path guarantee: browser and public requests must not pay for this.
    headers.authorization = 'Bearer eyJhbGciOi.session.token'
    const e = event()
    await authenticateMachineKey(e)
    expect(dbCalls).toBe(0)
    expect(recorded).toEqual([])
    expect(e.context.auth).toBeUndefined()
  })

  it('🔴 records the use of a valid secret key', async () => {
    // The other half of KH-987. api-keys.get filters on project, not on
    // keyType, so the key screen lists sk_ and pk_ rows together — writing only
    // on the CDN path would leave these reading "never used" next to rows that
    // had become right.
    headers.authorization = 'Bearer sk_live_abc'
    nextRows = [{ id: 'key-1', projectId: 'p1', organizationId: 'org-1' }]
    const e = event()
    await authenticateMachineKey(e)
    expect(recorded).toEqual(['hash(sk_live_abc)'])
    expect(e.context.auth).toEqual({ sub: 'machine:key-1', tenant: 'org-1' })
  })

  it('does NOT record a use for an unknown or revoked key', async () => {
    // The negative control: without it the cell above passes on code that
    // records every presented string, turning the column into a record of
    // guessing rather than of use.
    headers.authorization = 'Bearer sk_live_revoked'
    nextRows = []
    await authenticateMachineKey(event())
    expect(recorded).toEqual([])
  })

  it('records the use even when the token exchange then fails', async () => {
    // Deliberate: the key was valid and presented. "Was this key used?" is a
    // question about the key, not about whether auth happened to be reachable.
    headers.authorization = 'Bearer sk_live_abc'
    nextRows = [{ id: 'key-1', projectId: 'p1', organizationId: 'org-1' }]
    exchangeOk = false
    const e = event()
    await authenticateMachineKey(e)
    expect(recorded).toEqual(['hash(sk_live_abc)'])
    expect(e.context.auth).toBeUndefined()
  })

  // 🔴 NO CELL HERE FOR "only the hash is passed on", deliberately. This file
  // mocks hashApiKey, so such a cell would assert a property of the MOCK, not
  // of the code — it failed exactly that way when first written, and a cell
  // that measures its own fixture is worse than no cell. The property is
  // measured where the real hash runs: the /k route's cell asserts the recorded
  // value is 64 hex characters and is not the plaintext key from the URL.
})
