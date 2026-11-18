import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG } from '~~/tests/helpers/endpoint-fixtures'

// First cells for the customer-facing release path (869fbuf68). It had none,
// and it is the endpoint a mutation used to demonstrate the hole: wrapping its
// recordAuditEvent call in `if (false)` left the whole suite green.
//
// 🔴 THE PHASE ORDER IS THE CUSTOMER GUARANTEE, and it is what most of this
// file measures. The handler's own header states it: versioned blobs (B) before
// current blobs (C) before the active pointer (D), "never the other way around
// (UI says new active, CDN serves old)". Asserting that each phase HAPPENED
// would pass on any permutation, so every storage and pointer write lands in
// ONE ordered log and the cells read the sequence.

vi.mock('h3', () => mockH3())
vi.stubGlobal('defineRouteMeta', () => {})
vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ op: 'and', p }),
  desc: (c: unknown) => ({ op: 'desc', c }),
  eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
  inArray: (c: unknown, v: unknown) => ({ op: 'inArray', c, v }),
  isNull: (c: unknown) => ({ op: 'isNull', c }),
  max: (c: unknown) => ({ op: 'max', c }),
  notInArray: (c: unknown, v: unknown) => ({ op: 'notInArray', c, v }),
}))

/** Every side effect, in the order it happened. The sequence IS the contract. */
const log: string[] = []

let draft: Record<string, unknown> | undefined
let maxPublished: number | null = null
const attestationSets: Array<Record<string, unknown>> = []

vi.mock('~~/server/db', () => {
  const update = (table: string) => ({
    set: (vals: Record<string, unknown>) => ({
      where: () => {
        if (table === 'attestation') {
          attestationSets.push(vals)
          log.push('attestation:update')
          return Promise.resolve()
        }
        return {
          returning: () => Promise.resolve([{ id: 'cv-1', version: 4, publishedAt: new Date() }]),
        }
      },
    }),
  })
  const db = {
    select: (shape?: unknown) => ({
      from: (_t: unknown) => ({
        where: () => {
          if (shape) return Promise.resolve([{ value: maxPublished }])
          return { orderBy: () => ({ limit: () => Promise.resolve(draft ? [draft] : []) }) }
        },
      }),
    }),
    // Dispatched on IDENTITY against the mocked schema object, not on a string.
    // My first version compared `t === 'attestation'` while the schema mock
    // exports an object, so every attestation update was silently routed to the
    // configVersion branch and both retention cells saw an empty log.
    update: (t: unknown) =>
      update(
        (t as { __table?: string } | undefined)?.__table === 'fontLicenceAttestation'
          ? 'attestation'
          : 'configVersion',
      ),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => {
          log.push('D:active_version')
          return Promise.resolve()
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      log.push('A:promote')
      return fn({
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () =>
                Promise.resolve([{ id: 'cv-1', version: 4, publishedAt: new Date('2026-10-05') }]),
            }),
          }),
        }),
      })
    },
  }
  return { db }
})
vi.mock('~~/server/db/schema', () => ({
  activeVersion: 'activeVersion',
  configVersion: {
    id: 'id',
    projectId: 'projectId',
    status: 'status',
    createdAt: 'c',
    version: 'v',
  },
  fontLicenceAttestation: {
    __table: 'fontLicenceAttestation',
    projectId: 'projectId',
    file: 'file',
    servingEndedAt: 'servingEndedAt',
  },
}))

let putThrowsOn: string | null = null
vi.mock('~~/server/lib/storage', () => ({
  paths: (pid: string) => ({
    versionedJson: (v: number) => `p/${pid}/v${v}/tokens.json`,
    versionedCss: (v: number) => `p/${pid}/v${v}/tokens.css`,
    versionedAsset: (v: number, n: string) => `p/${pid}/v${v}/${n}`,
    currentJson: `p/${pid}/current.json`,
    currentCss: `p/${pid}/current.css`,
    currentAsset: (n: string) => `p/${pid}/current/${n}`,
    draftAsset: (n: string) => `p/${pid}/draft/${n}`,
  }),
  // 🔴 DEFERRED ON PURPOSE. With mocks that resolve immediately, the log is
  // filled before the next statement runs whether or not the handler awaited —
  // so the ordering cells measured DISPATCH order and a dropped `await` was
  // invisible. A mutation proved it: removing Phase C's await killed nothing.
  // One real tick makes the cells measure COMPLETION order instead.
  putObject: async (key: string) => {
    await new Promise((r) => setTimeout(r, 1))
    if (putThrowsOn && key.includes(putThrowsOn)) throw new Error('s3 down')
    log.push(`put:${key}`)
  },
  copyObject: async (from: string, to: string) => {
    await new Promise((r) => setTimeout(r, 1))
    log.push(`copy:${to}`)
  },
}))

let brandClaim: unknown = null
let capacityThrows: unknown = null
vi.mock('~~/server/lib/brand-hooks', () => ({
  notifyBrandCountChanged: (orgId: string) => {
    log.push(`report:${orgId}`)
  },
}))
vi.mock('~~/server/lib/brand-quota', () => ({
  assertBrandCapacity: () =>
    capacityThrows ? Promise.reject(capacityThrows) : Promise.resolve(brandClaim),
  claimBrandSlot: () => {
    log.push('A:claimBrandSlot')
    return Promise.resolve()
  },
}))

let purgeRejects = false
vi.mock('~~/server/lib/bunny', () => ({
  purgeProjectCdn: () => {
    log.push('E:purge')
    return purgeRejects ? Promise.reject(new Error('bunny down')) : Promise.resolve()
  },
}))

vi.mock('~~/server/lib/css-renderer', () => ({ renderTokensCss: () => ':root{}' }))
let referenced: Array<{ name: string; contentType: string }> = []
vi.mock('~~/server/lib/asset-upload', () => ({ referencedAssets: () => referenced }))
vi.mock('~~/server/lib/curated-fonts', () => ({
  curatedFontFiles: () => [],
  readCuratedFont: () => Promise.resolve(Buffer.from('')),
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...a: unknown[]) => requireProjectAccess(...a),
}))

const auditEvents: Array<Record<string, unknown>> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, payload: Record<string, unknown>) => {
    log.push('audit')
    auditEvents.push(payload)
    return Promise.resolve()
  },
}))

const handler = (await import('./publish.post')).default as unknown as (
  e: unknown,
) => Promise<Record<string, unknown>>

// Measured against the real tokensSchema: `colors`, not `color`.
const TOKENS = { colors: { primary: '#0a7cff' } }
const publish = () => handler(fakeEvent({ params: { projectId: PROJECT.id } }))

beforeEach(() => {
  log.length = 0
  auditEvents.length = 0
  attestationSets.length = 0
  draft = { id: 'cv-1', tokensJson: TOKENS }
  maxPublished = 3
  putThrowsOn = null
  brandClaim = null
  capacityThrows = null
  purgeRejects = false
  referenced = []
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    project: PROJECT,
    organization: ORG,
    role: 'editor',
    userId: 'user-1',
  })
})

describe('publishing a draft', () => {
  it('requires EDITOR', async () => {
    await publish()
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id, 'editor')
  })

  it('🔴 writes the audit event with the new version number', async () => {
    // The whole reason this file exists: before it, removing this call shipped
    // green.
    await publish()
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      action: 'config.published',
      targetType: 'project',
      targetId: PROJECT.id,
      targetLabel: PROJECT.name,
      after: { version: 4 },
    })
  })

  it('numbers the new version maxPublished + 1', async () => {
    await publish()
    await expect(publish()).resolves.toMatchObject({ version: 4 })
  })

  it('400s with no draft, before anything is written', async () => {
    draft = undefined
    await expect(publish()).rejects.toMatchObject({ statusCode: 400 })
    expect(log).toEqual([])
    expect(auditEvents).toEqual([])
  })
})

describe('🔴 the phase order is the customer guarantee', () => {
  it('runs A → B → C → D → audit, in that order', async () => {
    // Not "each phase happened" — the SEQUENCE. Phase C must overwrite the
    // current/* pointers the CDN reads BEFORE phase D flips the pointer the UI
    // reads, or Studio shows a version the CDN is not yet serving.
    await publish()
    const firstIndexOf = (pred: (l: string) => boolean) => log.findIndex(pred)
    const a = firstIndexOf((l) => l === 'A:promote')
    const b = firstIndexOf((l) => l.startsWith('put:') && l.includes('/v4/'))
    const c = firstIndexOf((l) => l.includes('current'))
    const d = firstIndexOf((l) => l === 'D:active_version')
    const e = firstIndexOf((l) => l === 'audit')
    expect([a, b, c, d, e].every((i) => i >= 0)).toBe(true)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    expect(c).toBeLessThan(d)
    expect(d).toBeLessThan(e)
  })

  it('🔴 a Phase B failure leaves the current/* pointers untouched', async () => {
    // The handler's own comment promises this: a missing draft blob fails the
    // publish BEFORE current/ is written, "så kunder aldrig ser en halv
    // version". Provoked rather than trusted.
    putThrowsOn = '/v4/'
    await expect(publish()).rejects.toThrow('s3 down')
    expect(log.filter((l) => l.includes('current'))).toEqual([])
    expect(log).not.toContain('D:active_version')
    expect(auditEvents).toEqual([])
  })

  // Overage billing (Allan 2026-10-27): a NEW brand changes what account bills,
  // so it is reported — after the brand row is written, never instead of it.
  it('🔴 reports the brand count to account after a new brand, not before', async () => {
    brandClaim = { organizationId: ORG.id, limit: 3 }
    await publish()
    const report = log.indexOf(`report:${ORG.id}`)
    expect(report).toBeGreaterThan(log.indexOf('A:claimBrandSlot'))
  })

  it('does not report when no brand was created', async () => {
    brandClaim = null
    await publish()
    expect(log.some((l) => l.startsWith('report:'))).toBe(false)
  })

  it('claims the brand slot inside the Phase A transaction, for a first version', async () => {
    // The cap is re-checked under the lock, so the claim must happen INSIDE the
    // transaction — outside it, two concurrent first publishes could share one
    // remaining slot.
    brandClaim = { organizationId: ORG.id, limit: 3 }
    await publish()
    const a = log.indexOf('A:promote')
    const claim = log.indexOf('A:claimBrandSlot')
    expect(claim).toBeGreaterThan(a)
    expect(claim).toBeLessThan(log.findIndex((l) => l.startsWith('put:')))
  })

  it('refuses before Phase A when the brand cap is exceeded, reserving nothing', async () => {
    capacityThrows = Object.assign(new Error('cap'), { statusCode: 402 })
    await expect(publish()).rejects.toMatchObject({ statusCode: 402 })
    expect(log).toEqual([])
  })
})

describe('🔴 the CDN purge must never fail the publish', () => {
  it('still resolves, and still audits, when the purge rejects', async () => {
    // 🔴 THE `.catch` IS THE PROTECTION, NOT THE `void`. I first mutated `void`
    // to `await` to kill this cell and it stayed green — awaiting a promise
    // whose rejection is already caught still resolves. The `void` only spares
    // the response the RTT to Bunny; removing the `.catch` is what breaks the
    // guarantee, and that is the mutation this cell actually answers to.
    // The CDN converges within max-age=60 regardless.
    purgeRejects = true
    await expect(publish()).resolves.toMatchObject({ version: 4 })
    expect(auditEvents).toHaveLength(1)
  })
})

describe('the font retention clock (jura §16a)', () => {
  it('starts the clock for everything when the new version serves no font files', async () => {
    referenced = []
    await publish()
    expect(attestationSets).toHaveLength(1)
    expect(attestationSets[0]!.servingEndedAt).toBeInstanceOf(Date)
  })

  it('🔴 clears it for a resumed file and starts it for the rest — two updates, both directions', async () => {
    // One field carries both directions. A cure that only ever STARTED the
    // clock would pass a cell that checked for "an update happened", so the
    // pair is asserted: null for what is served again, a Date for what is not.
    referenced = [{ name: 'fonts/inter.woff2', contentType: 'font/woff2' }]
    await publish()
    expect(attestationSets).toHaveLength(2)
    expect(attestationSets[0]).toMatchObject({ servingEndedAt: null })
    expect(attestationSets[1]!.servingEndedAt).toBeInstanceOf(Date)
  })
})
