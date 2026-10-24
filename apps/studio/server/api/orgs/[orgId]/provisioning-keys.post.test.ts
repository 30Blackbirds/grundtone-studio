import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Cells for KH-964 AC-A1/A2: who may mint an org-scoped provisioning key, what
// is stored, and what is returned.

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({ eq: () => null }))

let orgRole: string | null = 'owner'
let pdpDown = false
vi.mock('~~/server/lib/project-access', async () => {
  const ORG_ROLES = ['billing', 'member', 'admin', 'manager', 'owner'] as const
  return {
    ORG_ROLES,
    orgRoleHelpers: {
      canCreateProjects: (r: string) => r === 'owner' || r === 'manager' || r === 'admin',
    },
    requireOrgRole: (_e: unknown, organizationId: string, min: string) => {
      if (pdpDown) throw Object.assign(new Error('PDP unavailable'), { statusCode: 503 })
      if (!orgRole || ORG_ROLES.indexOf(orgRole as never) < ORG_ROLES.indexOf(min as never)) {
        throw Object.assign(new Error(`Requires org:${min}`), { statusCode: 403 })
      }
      return Promise.resolve({ userId: 'u-1', organizationId, role: orgRole })
    },
  }
})

const inserted: Record<string, unknown>[] = []
vi.mock('~~/server/db', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v)
        return {
          returning: () =>
            Promise.resolve([
              {
                id: 'key-1',
                keyPrefix: String(v.keyPrefix),
                keyType: String(v.keyType),
                environment: String(v.environment),
                rateLimit: Number(v.rateLimit),
                createdAt: new Date(0),
              },
            ]),
        }
      },
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({ apiKey: {} }))

const audits: Record<string, unknown>[] = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, entry: Record<string, unknown>) => {
    audits.push(entry)
    return Promise.resolve()
  },
}))

// The plan gate (KH-964 AC-E1). Its verdicts are measured in entitlements.test.ts.
let gateRefusal: { statusCode: number; data: { code: string } } | null = null
const gateAsked: string[] = []
vi.mock('~~/server/lib/entitlements', () => ({
  requireProvisioningFeature: (orgId: string) => {
    gateAsked.push(orgId)
    return gateRefusal
      ? Promise.reject(Object.assign(new Error('gate'), gateRefusal))
      : Promise.resolve()
  },
}))

const handler = (await import('./provisioning-keys.post')).default as unknown as (
  e: ReturnType<typeof fakeEvent>,
) => Promise<Record<string, unknown>>

const call = (body: unknown = {}) =>
  handler(fakeEvent({ params: { orgId: 'org-1' }, body }) as never)

beforeEach(() => {
  inserted.length = 0
  audits.length = 0
  orgRole = 'owner'
  pdpDown = false
  gateRefusal = null
  gateAsked.length = 0
})

describe('AC-A1: who may mint one — the ACCEPT set', () => {
  // 🔴 The accept set is run, not only the refusal set. A gate that refuses
  // everyone looks like working security until someone needs a key.
  it.each(['owner', 'manager', 'admin'])('%s can mint', async (role) => {
    orgRole = role
    const res = await call()
    expect(res.keyType).toBe('provisioning')
    expect(inserted).toHaveLength(1)
  })
})

describe('AC-A2: the REFUSE set', () => {
  // 🔴 THE TWO REFUSALS COME FROM TWO DIFFERENT MECHANISMS, measured by
  // mutation: removing the canCreateProjects predicate turns ONE of these red,
  // not both. `billing` ranks below `member` and is refused by
  // requireOrgRole's floor; `member` passes the floor and is refused by the
  // predicate. Reading this as "one cell covers both" would leave the
  // predicate half-unmeasured.
  it.each(['member', 'billing'])('%s is refused with 403, and nothing is written', async (role) => {
    orgRole = role
    await expect(call()).rejects.toMatchObject({ statusCode: 403 })
    expect(inserted).toEqual([])
    expect(audits).toEqual([])
  })

  it('a non-member is refused', async () => {
    orgRole = null
    await expect(call()).rejects.toMatchObject({ statusCode: 403 })
  })

  it('🔴 a PDP that cannot answer does NOT mint — the refusal propagates', async () => {
    // fail-closed: "we could not determine the role" must not read as "allowed".
    pdpDown = true
    await expect(call()).rejects.toMatchObject({ statusCode: 503 })
    expect(inserted).toEqual([])
  })
})

describe('what is stored and returned', () => {
  it('🔴 stores organizationId and NO projectId', async () => {
    // The scope rule the check constraint enforces in the database. Setting
    // both would make every existing project guard adjudicate this as a
    // project key — a permission bug in appearance, a data bug in fact.
    await call()
    expect(inserted[0]!.organizationId).toBe('org-1')
    expect(inserted[0]!.projectId).toBeUndefined()
  })

  it('stores only the hash, and returns the plaintext exactly once', async () => {
    const res = await call()
    expect(String(inserted[0]!.keyHash)).toMatch(/^[a-f0-9]{64}$/)
    expect(inserted[0]).not.toHaveProperty('plaintext')
    expect(String(res.plaintext)).toMatch(/^prov_live_[a-f0-9]{64}$/)
    // …and the stored prefix is a prefix OF that plaintext, not a separate guess.
    expect(String(res.plaintext).startsWith(String(inserted[0]!.keyPrefix))).toBe(true)
  })

  it('gives the key its own prefix, distinct from pk_ and sk_', async () => {
    const res = await call()
    expect(String(res.plaintext).startsWith('prov_')).toBe(true)
    expect(String(res.plaintext).startsWith('pk_')).toBe(false)
    expect(String(res.plaintext).startsWith('sk_')).toBe(false)
  })

  it('writes an audit event naming the org and the key', async () => {
    await call()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      organizationId: 'org-1',
      action: 'provisioning_key.created',
      targetType: 'api_key',
      targetId: 'key-1',
    })
  })

  it('rejects a rate limit outside the allowed range, before writing', async () => {
    await expect(call({ rateLimit: 0 })).rejects.toMatchObject({ statusCode: 400 })
    expect(inserted).toEqual([])
  })
})

describe('🔴 AC-E1: an org without the provisioning API cannot mint a key', () => {
  it.each([
    [403, 'feature_not_enabled'],
    [403, 'suspended'],
    [503, 'entitlements_unavailable'],
  ])('a %i %s refusal mints nothing and audits nothing', async (statusCode, code) => {
    gateRefusal = { statusCode, data: { code } }
    await expect(call()).rejects.toMatchObject({ statusCode, data: { code } })
    expect(inserted).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })

  it('asks about the org in the path', async () => {
    await call()
    expect(gateAsked).toEqual(['org-1'])
  })

  it('the role check answers before the plan — a member hears 403 for the role, not the plan', async () => {
    orgRole = 'member'
    await expect(call()).rejects.toMatchObject({ statusCode: 403 })
    expect(gateAsked).toHaveLength(0)
  })
})
