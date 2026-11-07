import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG } from '~~/tests/helpers/endpoint-fixtures'

// First cells for the rollback path (869fbuf68). It had none, so its audit
// event was unproven — the same gap a mutation demonstrated on publish.post.
//
// 🔴 THE STORAGE MOCKS DEFER ONE REAL TICK, deliberately. On publish.post the
// ordering cells first measured DISPATCH order and a dropped `await` killed
// nothing, because mocks that resolve immediately fill the log before the next
// statement runs either way. One tick makes the sequence cells measure
// COMPLETION order.

vi.mock('h3', () => mockH3())
vi.stubGlobal('defineRouteMeta', () => {})
vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ op: 'and', p }),
  eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
}))

const log: string[] = []
const wheres: unknown[] = []
let versionRow: Record<string, unknown> | undefined

vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          wheres.push(w)
          return Promise.resolve(versionRow ? [versionRow] : [])
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => {
          log.push('flip:active_version')
          return Promise.resolve()
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      log.push('claim:transaction')
      return fn({})
    },
  },
}))
vi.mock('~~/server/db/schema', () => ({
  activeVersion: 'activeVersion',
  configVersion: { id: 'id', projectId: 'projectId', status: 'status', version: 'version' },
}))

let archivedCss: string | null = ':root{--archived:1}'
vi.mock('~~/server/lib/storage', () => ({
  paths: (pid: string) => ({
    versionedCss: (v: number) => `p/${pid}/v${v}/tokens.css`,
    currentJson: `p/${pid}/current.json`,
    currentCss: `p/${pid}/current.css`,
  }),
  getObjectAsString: async () => {
    await new Promise((r) => setTimeout(r, 1))
    return archivedCss
  },
  putObject: async (key: string, body: string) => {
    await new Promise((r) => setTimeout(r, 1))
    log.push(`put:${key}`)
    bodies[key] = body
  },
}))
// `let`, not `const`: resetting by deleting computed keys trips
// @typescript-eslint/no-dynamic-delete, which I had already hit and fixed in
// provisioning-auth.test.ts and then reintroduced here. A fresh object is the
// clearer reset anyway, and the mock closes over the BINDING so reassignment
// is visible to it.
let bodies: Record<string, string> = {}

const renderTokensCss = vi.fn(() => ':root{--rerendered:1}')
vi.mock('~~/server/lib/css-renderer', () => ({ renderTokensCss: () => renderTokensCss() }))

let brandClaim: unknown = null
let capacityThrows: unknown = null
vi.mock('~~/server/lib/brand-count', () => ({
  reportBrandCount: (orgId: string) => {
    log.push(`report:${orgId}`)
    return Promise.resolve({ kind: 'applied' })
  },
}))
vi.mock('~~/server/lib/brand-quota', () => ({
  assertBrandCapacity: () =>
    capacityThrows ? Promise.reject(capacityThrows) : Promise.resolve(brandClaim),
  claimBrandSlot: () => {
    log.push('claim:slot')
    return Promise.resolve()
  },
}))

let purgeRejects = false
vi.mock('~~/server/lib/bunny', () => ({
  purgeProjectCdn: () => {
    log.push('purge')
    return purgeRejects ? Promise.reject(new Error('bunny down')) : Promise.resolve()
  },
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

const handler = (await import('./activate.post')).default as unknown as (
  e: unknown,
) => Promise<Record<string, unknown>>

// `versionId` is `z.uuid()` — measured, after a fixture of 'cv-2' failed every
// cell with `Invalid UUID`. Fifth fixture guess this session to be checked
// against the schema rather than assumed.
const VERSION_ID = '11111111-2222-4333-8444-555555555555'
const activate = (versionId = VERSION_ID) =>
  handler(fakeEvent({ params: { projectId: PROJECT.id }, body: { versionId } }))

/** Every leaf `eq` the version lookup was narrowed with. */
function narrowedOn(): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (o.op === 'and') (o.p as unknown[]).forEach(walk)
    else if (o.op === 'eq') out.push(`${String(o.c)}=${String(o.v)}`)
  }
  wheres.forEach(walk)
  return out
}

beforeEach(() => {
  log.length = 0
  wheres.length = 0
  auditEvents.length = 0
  bodies = {}
  versionRow = { id: VERSION_ID, version: 2, tokensJson: { colors: { primary: '#0a7cff' } } }
  archivedCss = ':root{--archived:1}'
  brandClaim = null
  capacityThrows = null
  purgeRejects = false
  renderTokensCss.mockClear()
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    project: PROJECT,
    organization: ORG,
    role: 'editor',
    userId: 'user-1',
  })
})

describe('rolling back to a published version', () => {
  it('requires EDITOR', async () => {
    await activate()
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id, 'editor')
  })

  it('🔴 writes the audit event with the version it rolled back TO', async () => {
    // The whole reason this file exists. `after.version` must be the target
    // version, not the one that was active — an audit row naming the wrong
    // version is worse than none, because it reads as a record.
    await activate()
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      action: 'config.activated',
      targetType: 'project',
      targetId: PROJECT.id,
      targetLabel: PROJECT.name,
      after: { version: 2 },
    })
  })

  it('🔴 narrows the lookup on id, projectId AND status=published — three legs', async () => {
    // Two boundaries in one query. Without `projectId` one project could
    // activate another project's version by id; without `status` it could
    // activate a DRAFT, publishing unreviewed tokens to the CDN through the
    // rollback door. Both would 404 today, and that is what this asserts.
    await activate()
    expect(narrowedOn()).toEqual(
      expect.arrayContaining([`id=${VERSION_ID}`, `projectId=${PROJECT.id}`, 'status=published']),
    )
  })

  it('404s for an unknown or unpublished version, writing nothing', async () => {
    versionRow = undefined
    await expect(activate()).rejects.toMatchObject({ statusCode: 404 })
    expect(log).toEqual([])
    expect(auditEvents).toEqual([])
  })

  it('400s on a body without a versionId, before the lookup', async () => {
    await expect(
      handler(fakeEvent({ params: { projectId: PROJECT.id }, body: {} })),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(wheres).toEqual([])
  })
})

describe('🔴 the pointer blobs are written before the pointer flips', () => {
  it('writes current/* and only THEN flips active_version, then audits', async () => {
    // The same guarantee publish carries: what the CDN serves must change
    // before what Studio's UI reports, never the other way around. Asserting
    // that both happened would pass on either order.
    await activate()
    const put = log.findIndex((l) => l.startsWith('put:'))
    const flip = log.indexOf('flip:active_version')
    const audit = log.indexOf('audit')
    expect([put, flip, audit].every((i) => i >= 0)).toBe(true)
    expect(put).toBeLessThan(flip)
    expect(flip).toBeLessThan(audit)
  })

  // Overage billing (Allan 2026-10-27): a NEW brand changes what account bills,
  // so it is reported — after the brand row is written, never instead of it.
  it('🔴 reports the brand count to account after a new brand, not before', async () => {
    brandClaim = { organizationId: ORG.id, limit: 3 }
    await activate()
    const report = log.indexOf(`report:${ORG.id}`)
    expect(report).toBeGreaterThan(log.indexOf('claim:slot'))
  })

  it('does not report when no brand was created', async () => {
    brandClaim = null
    await activate()
    expect(log.some((l) => l.startsWith('report:'))).toBe(false)
  })

  it('claims a brand slot before any blob write, and only when there is a claim', async () => {
    brandClaim = { organizationId: ORG.id, limit: 3 }
    await activate()
    expect(log.indexOf('claim:slot')).toBeLessThan(log.findIndex((l) => l.startsWith('put:')))
  })

  it('does NOT claim for a rollback, where the project already has a brand', async () => {
    // The negative half. assertBrandCapacity answers null once a brand exists,
    // and a rollback that claimed again would consume a second slot for one
    // project.
    brandClaim = null
    await activate()
    expect(log).not.toContain('claim:slot')
    expect(log).not.toContain('claim:transaction')
  })

  it('refuses before anything is written when the cap is exceeded', async () => {
    capacityThrows = Object.assign(new Error('cap'), { statusCode: 402 })
    await expect(activate()).rejects.toMatchObject({ statusCode: 402 })
    expect(log).toEqual([])
  })
})

describe('🔴 the CSS fallback — both branches, and what the second one costs', () => {
  it('serves the ARCHIVED css when the versioned blob is still there', async () => {
    await activate()
    expect(bodies[`p/${PROJECT.id}/current.css`]).toBe(':root{--archived:1}')
    expect(renderTokensCss).not.toHaveBeenCalled()
  })

  it('re-renders from the DB row when the archived blob is gone', async () => {
    archivedCss = null
    await activate()
    expect(renderTokensCss).toHaveBeenCalledTimes(1)
    expect(bodies[`p/${PROJECT.id}/current.css`]).toBe(':root{--rerendered:1}')
  })

  it('🔴 RECORDED: the fallback is not byte-identical to what that version served', async () => {
    // Both branches work, and the pair above proves it. What neither proves is
    // FIDELITY: renderTokensCss is deterministic for the same tokens, so the
    // re-render matches only while the RENDERER is unchanged. Upgrade it — new
    // custom property, different ordering, a fixed rounding — and a rollback
    // whose archived blob is missing serves CSS the version never served,
    // silently, under the same version number.
    //
    // Measured here as a DIFFERENCE, not asserted as a bug: the two branches
    // produce different bytes from the same row. Whether that matters is a
    // decision about rollback fidelity, not something a cell settles, and the
    // handler's comment ("avoids re-reading from storage") does not mention it.
    await activate()
    const archived = bodies[`p/${PROJECT.id}/current.css`]
    log.length = 0
    bodies = {}
    archivedCss = null
    await activate()
    const rerendered = bodies[`p/${PROJECT.id}/current.css`]
    expect(archived).not.toBe(rerendered)
  })
})

describe('the CDN purge must never fail the rollback', () => {
  it('still resolves and still audits when the purge rejects', async () => {
    // As on publish: the `.catch` is the protection, not the `void` — awaiting
    // a promise whose rejection is already caught still resolves. The `void`
    // only spares the response the RTT to Bunny.
    purgeRejects = true
    await expect(activate()).resolves.toMatchObject({ version: 2 })
    expect(auditEvents).toHaveLength(1)
  })
})
