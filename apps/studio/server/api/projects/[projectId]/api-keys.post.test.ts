import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { fakeEvent, mockH3, PROJECT, ORG } from '~~/tests/helpers/endpoint-fixtures'

// First cells for key minting (869fbuf68). It had none, so its audit event was
// unproven — and so was the property the whole key design rests on: that only
// the hash is stored.
//
// 🔴 generateApiKey AND THE HASH ARE THE REAL ONES. A cell that mocked them
// would assert that my stub returns what my stub returns. There is a cell in
// machine-auth.test.ts that was deleted for exactly that reason, so the
// relationship between plaintext and stored hash is measured here against
// node's own sha256.

// 🔴 THIS ENDPOINT DOES NOT IMPORT h3 — it relies on Nuxt auto-imports, so
// `vi.mock('h3', ...)` reaches nothing and the module fails to load with
// `defineEventHandler is not defined`. Measured across the six: four import h3
// explicitly (publish, activate, config, tokens/import) and two do not (both
// api-keys endpoints). The harness shape is decided by the endpoint, not by
// preference.
const h3 = mockH3()
vi.stubGlobal('defineEventHandler', h3.defineEventHandler)
vi.stubGlobal('getRouterParam', h3.getRouterParam)
vi.stubGlobal('createError', h3.createError)
vi.stubGlobal('readBody', h3.readBody)
vi.stubGlobal('defineRouteMeta', () => {})
vi.mock('drizzle-orm', () => ({ eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }) }))

let inserted: Record<string, unknown> | null = null
const deletes: unknown[] = []
vi.mock('~~/server/db', () => ({
  db: {
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          inserted = vals
          return Promise.resolve([
            {
              id: 'key-1',
              keyPrefix: vals.keyPrefix,
              keyType: vals.keyType,
              environment: vals.environment,
              allowedOrigins: vals.allowedOrigins,
              rateLimit: vals.rateLimit,
              createdAt: new Date('2026-10-06'),
            },
          ])
        },
      }),
    }),
    delete: () => ({
      where: (w: unknown) => {
        deletes.push(w)
        return Promise.resolve()
      },
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({ apiKey: { id: 'id' } }))

const grantMachineProjectRole = vi.fn()
vi.mock('~~/server/lib/pdp', () => ({
  grantMachineProjectRole: (...a: unknown[]) => grantMachineProjectRole(...a),
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...a: unknown[]) => requireProjectAccess(...a),
}))

const auditEvents: Array<Record<string, unknown>> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, payload: Record<string, unknown>) => {
    auditEvents.push(payload)
    return Promise.resolve()
  },
}))

const handler = (await import('./api-keys.post')).default as unknown as (
  e: unknown,
) => Promise<Record<string, unknown>>

const mint = (body: unknown = {}) => handler(fakeEvent({ params: { projectId: PROJECT.id }, body }))

beforeEach(() => {
  inserted = null
  deletes.length = 0
  auditEvents.length = 0
  grantMachineProjectRole.mockReset()
  grantMachineProjectRole.mockResolvedValue(undefined)
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    project: PROJECT,
    organization: ORG,
    role: 'admin',
    userId: 'user-1',
  })
})

describe('minting an API key', () => {
  it('requires project ADMIN, not editor', async () => {
    // Key administration is one of the two things AC-D2 refuses to a machine.
    // Asserted on the argument: a gate called with 'editor' passes its own
    // happy path and would let any token editor mint credentials.
    await mint()
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id, 'admin')
  })

  it('🔴 writes the audit event with the key id, a label and the key SHAPE', async () => {
    // The whole reason this file exists. The payload carries keyType,
    // environment, origins and the rate limit — the shape of the authority
    // granted — and never the key itself.
    await mint({ keyType: 'publishable', rateLimit: 500 })
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: 'key-1',
      organizationId: ORG.id,
      after: { keyType: 'publishable', rateLimit: 500 },
    })
    expect(auditEvents[0]!.targetLabel).toContain('pk_')
  })

  it('defaults to a publishable key on an empty body', async () => {
    await mint({})
    expect(inserted).toMatchObject({ keyType: 'publishable', rateLimit: 1000 })
  })

  it('400s on an invalid body and inserts nothing', async () => {
    await expect(mint({ keyType: 'root' })).rejects.toMatchObject({ statusCode: 400 })
    expect(inserted).toBeNull()
    expect(auditEvents).toEqual([])
  })
})

describe('🔴 only the HASH is stored, and the plaintext is returned once', () => {
  it('stores sha256(plaintext) and never the plaintext itself', async () => {
    // The property the whole key design rests on (CLAUDE.md: "hash SHA-256 at
    // rest, plaintext shown once"). Measured against node's own sha256 rather
    // than against the app's hash helper, so the two cannot agree by sharing a
    // bug.
    const res = await mint({ keyType: 'publishable' })
    const plaintext = res.plaintext as string
    expect(plaintext).toMatch(/^pk_/)
    expect(inserted!.keyHash).toBe(createHash('sha256').update(plaintext).digest('hex'))

    // 🔴 And the plaintext is absent from the stored row entirely — not merely
    // absent from one field. A future column that happened to carry it would
    // pass a check that only looked at keyHash.
    expect(JSON.stringify(inserted)).not.toContain(plaintext)
  })

  it('does not leak the plaintext into the audit row either', async () => {
    const res = await mint({ keyType: 'secret' })
    expect(JSON.stringify(auditEvents[0])).not.toContain(res.plaintext as string)
  })

  it('🔴 the stored prefix is a GENUINE prefix of the plaintext', async () => {
    // Measured, after assuming the prefix was just type+env: it is
    // `sk_live_291f` — type, environment AND a short slice of the key, i.e. a
    // DISPLAY prefix. That makes the stronger assertion the right one: the
    // prefix must actually begin the plaintext, or a UI listing keys by prefix
    // points at the wrong key and an operator revokes the wrong credential.
    const res = await mint({ keyType: 'secret' })
    const plaintext = res.plaintext as string
    const prefix = res.keyPrefix as string
    expect(prefix).toMatch(/^sk_live_/)
    expect(plaintext.startsWith(prefix)).toBe(true)
    expect(prefix.length).toBeLessThan(plaintext.length)
  })
})

describe('🔴 the PDP tuple is granted only for a SECRET key', () => {
  // The mirror of revocation, which deletes the tuple only for sk_. A pk_ key
  // has no tuple, and granting one would hand a read-only CDN key editor
  // authority in the source of truth.
  it('grants editor for sk_', async () => {
    await mint({ keyType: 'secret' })
    expect(grantMachineProjectRole).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT.id,
      'key-1',
      'editor',
    )
  })

  it('does NOT for pk_ (negative control)', async () => {
    await mint({ keyType: 'publishable' })
    expect(grantMachineProjectRole).not.toHaveBeenCalled()
  })
})

describe('🔴 a PDP failure rolls the key back', () => {
  it('deletes the row and writes NO audit event', async () => {
    // An authority-less secret key left in the table is worse than no key: it
    // authenticates and then fails every authorisation, which reads as a bug in
    // the product rather than a failed mint.
    //
    // Worth naming beside this: the REVOKE endpoint
    // (api-keys/[keyId].delete.ts) does the opposite — its PDP call is not
    // wrapped, so a PDP outage there leaves the key revoked, the tuple standing
    // and no audit row. Two choices in one feature area; this one is the
    // careful shape.
    grantMachineProjectRole.mockRejectedValue(new Error('pdp down'))
    await expect(mint({ keyType: 'secret' })).rejects.toThrow('pdp down')
    expect(deletes).toHaveLength(1)
    expect(auditEvents).toEqual([])
  })
})
