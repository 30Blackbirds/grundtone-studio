import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSpies,
  fakeEvent,
  mockH3,
  PROJECT,
  ORG,
  SESSION,
} from '~~/tests/helpers/endpoint-fixtures'

const spies = createSpies()

interface VersionRow {
  id: string
  projectId: string
  version: number
  status: 'draft' | 'published'
  tokensJson: Record<string, unknown>
}

const versions: VersionRow[] = []

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: () => null,
  eq: () => null,
}))

const txMock = { handle: 'transaction' }
const dbMock = {
  transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(txMock),
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(versions.slice(0, 1)),
    }),
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      spies.inserts.push({ table: 'active_version', values: v })
      return { onConflictDoUpdate: () => Promise.resolve() }
    },
  }),
}
vi.mock('~~/server/db', () => ({ db: dbMock }))
vi.mock('~~/server/db/schema', () => ({
  configVersion: { _: { name: 'config_version' } },
  activeVersion: { _: { name: 'active_version' } },
}))

vi.mock('~~/server/lib/css-renderer', () => ({
  renderTokensCss: () => ':root{--rebuilt}',
}))
vi.mock('~~/server/lib/storage', () => ({
  paths: (projectId: string) => ({
    versionedCss: (n: number) => `p/${projectId}/v${n}/tokens.css`,
    currentJson: `p/${projectId}/current.json`,
    currentCss: `p/${projectId}/current.css`,
  }),
  putObject: (key: string, body: string, opts: { contentType: string }) => {
    spies.storage.push({ key, contentType: opts.contentType, bodyPreview: body.slice(0, 32) })
    return Promise.resolve()
  },
  // Returns the cached versioned CSS so activate skips re-rendering.
  getObjectAsString: () => Promise.resolve(':root{--cached}'),
}))

vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    spies.audit.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

vi.mock('~~/server/lib/bunny', () => ({
  purgeProjectCdn: (projectId: string) => {
    spies.bunnyPurges.push(projectId)
    return Promise.resolve(0)
  },
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

// ─── brand quota — the cap itself is tested in server/lib/brand-quota.test.ts ──
const assertBrandCapacity = vi.fn()
const claimBrandSlot = vi.fn()
vi.mock('~~/server/lib/brand-quota', () => ({
  assertBrandCapacity: (...args: unknown[]) => assertBrandCapacity(...args),
  claimBrandSlot: (...args: unknown[]) => claimBrandSlot(...args),
}))
const SOLO_CLAIM = { organizationId: ORG.id, entitlements: null, hardCap: true }

const handler = (await import('./activate.post')).default as unknown as (
  event: unknown,
) => Promise<unknown>

beforeEach(() => {
  spies.inserts.length = 0
  spies.audit.length = 0
  spies.storage.length = 0
  spies.bunnyPurges.length = 0
  versions.length = 0
  assertBrandCapacity.mockReset()
  assertBrandCapacity.mockResolvedValue(null)
  claimBrandSlot.mockReset()
  claimBrandSlot.mockResolvedValue(undefined)
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'admin',
    source: 'org',
    orgRole: 'owner',
    projectRole: null,
  })
})

describe('POST /api/projects/[projectId]/activate', () => {
  it('400s when projectId is missing', async () => {
    await expect(
      handler(fakeEvent({ body: { versionId: '11111111-1111-4111-8111-111111111199' } })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('400s when the body is missing versionId', async () => {
    await expect(
      handler(fakeEvent({ params: { projectId: PROJECT.id }, body: {} })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('404s when the requested version is not found / not published', async () => {
    versions.length = 0
    await expect(
      handler(
        fakeEvent({
          params: { projectId: PROJECT.id },
          body: { versionId: '11111111-1111-4111-8111-111111111199' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rolls back to a published version: writes current pointers, flips active, audits, purges', async () => {
    versions.push({
      id: '11111111-1111-4111-8111-111111111105',
      projectId: PROJECT.id,
      version: 5,
      status: 'published',
      tokensJson: { colors: { primary: '#0EA5E9' } },
    })

    const res = (await handler(
      fakeEvent({
        params: { projectId: PROJECT.id },
        body: { versionId: '11111111-1111-4111-8111-111111111105' },
      }),
    )) as { version: number; activatedAt: Date }

    expect(res.version).toBe(5)

    // Two storage writes: current.json + current.css (no versioned writes
    // since activate doesn't archive a new version, it just flips pointer).
    expect(spies.storage).toHaveLength(2)
    expect(spies.storage.map((s) => s.key)).toEqual([
      `p/${PROJECT.id}/current.json`,
      `p/${PROJECT.id}/current.css`,
    ])

    expect(spies.inserts).toHaveLength(1)
    expect(spies.inserts[0].table).toBe('active_version')
    // A rollback of an existing brand (assertBrandCapacity → null) claims nothing.
    expect(claimBrandSlot).not.toHaveBeenCalled()

    expect(spies.audit).toHaveLength(1)
    expect(spies.audit[0].action).toBe('config.activated')
    expect(spies.audit[0].payload).toMatchObject({
      organizationId: ORG.id,
      targetId: PROJECT.id,
      after: { version: 5 },
    })

    expect(spies.bunnyPurges).toEqual([PROJECT.id])
  })
  it('refuses when activating would create a new brand over the hard cap, writing nothing', async () => {
    versions.push({
      id: '11111111-1111-4111-8111-111111111106',
      projectId: PROJECT.id,
      version: 6,
      status: 'published',
      tokensJson: { colors: { primary: '#0EA5E9' } },
    })
    assertBrandCapacity.mockRejectedValue(
      Object.assign(new Error('Active brand limit reached for this plan'), {
        statusCode: 403,
        data: { code: 'brand_quota_exceeded', limit: 3, planKey: 'studio_solo' },
      }),
    )

    await expect(
      handler(
        fakeEvent({
          params: { projectId: PROJECT.id },
          body: { versionId: '11111111-1111-4111-8111-111111111106' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, data: { code: 'brand_quota_exceeded' } })

    expect(assertBrandCapacity).toHaveBeenCalledWith(ORG.id, PROJECT.id)
    expect(claimBrandSlot).not.toHaveBeenCalled()
    expect(spies.storage).toHaveLength(0)
    expect(spies.inserts).toHaveLength(0)
    expect(spies.audit).toHaveLength(0)
    expect(spies.bunnyPurges).toHaveLength(0)
  })

  it('creates the brand in a transaction before any blob write on a first activation', async () => {
    versions.push({
      id: '11111111-1111-4111-8111-111111111107',
      projectId: PROJECT.id,
      version: 7,
      status: 'published',
      tokensJson: { colors: { primary: '#0EA5E9' } },
    })
    assertBrandCapacity.mockResolvedValue(SOLO_CLAIM)
    const storageAtClaim: number[] = []
    claimBrandSlot.mockImplementation(() => {
      storageAtClaim.push(spies.storage.length)
      return Promise.resolve()
    })

    await handler(
      fakeEvent({
        params: { projectId: PROJECT.id },
        body: { versionId: '11111111-1111-4111-8111-111111111107' },
      }),
    )

    expect(claimBrandSlot).toHaveBeenCalledWith(txMock, SOLO_CLAIM, {
      projectId: PROJECT.id,
      configVersionId: '11111111-1111-4111-8111-111111111107',
      activatedBy: SESSION.user.id,
      activatedByEmail: SESSION.user.email,
    })
    expect(storageAtClaim).toEqual([0])
    expect(spies.storage).toHaveLength(2)
  })

  it('fails a first activation whose claim is refused under the lock, writing nothing', async () => {
    versions.push({
      id: '11111111-1111-4111-8111-111111111108',
      projectId: PROJECT.id,
      version: 8,
      status: 'published',
      tokensJson: { colors: { primary: '#0EA5E9' } },
    })
    assertBrandCapacity.mockResolvedValue(SOLO_CLAIM)
    claimBrandSlot.mockRejectedValue(
      Object.assign(new Error('Active brand limit reached for this plan'), {
        statusCode: 403,
        data: { code: 'brand_quota_exceeded', limit: 3, planKey: 'studio_solo' },
      }),
    )

    await expect(
      handler(
        fakeEvent({
          params: { projectId: PROJECT.id },
          body: { versionId: '11111111-1111-4111-8111-111111111108' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, data: { code: 'brand_quota_exceeded' } })

    expect(spies.storage).toHaveLength(0)
    expect(spies.inserts).toHaveLength(0)
    expect(spies.audit).toHaveLength(0)
    expect(spies.bunnyPurges).toHaveLength(0)
  })
})
