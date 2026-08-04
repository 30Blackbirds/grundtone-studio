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

interface DraftRow {
  id: string
  projectId: string
  version: number
  status: 'draft' | 'published'
  tokensJson: Record<string, unknown>
  publishedAt: Date | null
  publishedBy: string | null
  createdAt: Date
}

const draft: DraftRow[] = []
const published: DraftRow[] = []

// ─── h3 ───────────────────────────────────────────────────────────────────
vi.mock('h3', () => mockH3())

// ─── drizzle-orm ──────────────────────────────────────────────────────────
vi.mock('drizzle-orm', () => ({
  and: () => null,
  desc: () => null,
  eq: () => null,
  max: () => null,
}))

// ─── db ───────────────────────────────────────────────────────────────────
// Lightweight query builder that returns drafts, published rows, or max
// version depending on what was selected. Handlers chain
// `.select(...).from(table).where(...).orderBy(...).limit(N)` so we hand
// back an awaitable that walks the in-memory arrays.
const dbMock = {
  select: (cols?: Record<string, unknown>) => {
    const isMaxQuery = cols && 'value' in cols
    return {
      from: () => ({
        where: () => {
          const query = {
            orderBy: () => ({
              limit: () => Promise.resolve(draft.slice(0, 1)),
            }),
            then: (resolve: (rows: unknown[]) => unknown) => {
              if (isMaxQuery) {
                const value = published.reduce((m, r) => Math.max(m, r.version), 0)
                return Promise.resolve([{ value: value === 0 ? null : value }]).then(resolve)
              }
              return Promise.resolve([]).then(resolve)
            },
          }
          return query
        },
      }),
    }
  },
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      spies.inserts.push({ table: 'active_version', values: v })
      return {
        onConflictDoUpdate: () => Promise.resolve(),
      }
    },
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      update: () => ({
        set: (s: Record<string, unknown>) => {
          spies.updates.push({ table: 'config_version', set: s })
          return {
            where: () => ({
              returning: () => {
                const promoted = { ...draft[0], ...s }
                published.push(promoted as DraftRow)
                draft.length = 0
                return Promise.resolve([promoted])
              },
            }),
          }
        },
      }),
    }
    return fn(tx)
  },
}
vi.mock('~~/server/db', () => ({ db: dbMock }))
vi.mock('~~/server/db/schema', () => ({
  configVersion: { _: { name: 'config_version' } },
  activeVersion: { _: { name: 'active_version' } },
}))

// ─── helpers + storage ───────────────────────────────────────────────────
vi.mock('~~/server/lib/css-renderer', () => ({
  renderTokensCss: () => ':root{--color-primary:#000}',
}))
vi.mock('~~/server/lib/storage', () => ({
  paths: (projectId: string) => ({
    versionedJson: (n: number) => `p/${projectId}/v${n}/tokens.json`,
    versionedCss: (n: number) => `p/${projectId}/v${n}/tokens.css`,
    currentJson: `p/${projectId}/current.json`,
    currentCss: `p/${projectId}/current.css`,
    draftAsset: (name: string) => `p/${projectId}/draft/${name}`,
    versionedAsset: (n: number, name: string) => `p/${projectId}/v${n}/${name}`,
    currentAsset: (name: string) => `p/${projectId}/current/${name}`,
  }),
  putObject: (key: string, body: string, opts: { contentType: string }) => {
    spies.storage.push({ key, contentType: opts.contentType, bodyPreview: body.slice(0, 32) })
    return Promise.resolve()
  },
  copyObject: (sourceKey: string, destKey: string, opts: { contentType: string }) => {
    spies.storage.push({
      key: destKey,
      contentType: opts.contentType,
      bodyPreview: `copy:${sourceKey}`,
    })
    return Promise.resolve()
  },
}))

// ─── tokens schema — pass-through, no validation in tests ────────────────
vi.mock('~~/server/lib/tokens', () => ({
  tokensSchema: { parse: (v: unknown) => v },
}))

// ─── audit ────────────────────────────────────────────────────────────────
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    spies.audit.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

// ─── bunny ────────────────────────────────────────────────────────────────
vi.mock('~~/server/lib/bunny', () => ({
  purgeProjectCdn: (projectId: string) => {
    spies.bunnyPurges.push(projectId)
    return Promise.resolve(0)
  },
}))

// ─── project-access ──────────────────────────────────────────────────────
const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const handler = (await import('./publish.post')).default as unknown as (
  event: unknown,
) => Promise<unknown>

beforeEach(() => {
  spies.inserts.length = 0
  spies.updates.length = 0
  spies.audit.length = 0
  spies.storage.length = 0
  spies.bunnyPurges.length = 0
  draft.length = 0
  published.length = 0
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

describe('POST /api/projects/[projectId]/publish', () => {
  it('400s when projectId is missing', async () => {
    await expect(handler(fakeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('400s when there is no draft to publish', async () => {
    draft.length = 0
    await expect(handler(fakeEvent({ params: { projectId: PROJECT.id } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'No draft to publish',
    })
  })

  it('promotes the draft, writes 4 storage objects, flips active pointer, and emits audit + purge', async () => {
    draft.push({
      id: 'draft-1',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: { colors: { primary: '#4F46E5' } },
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date('2026-05-26T10:00:00Z'),
    })

    const res = (await handler(fakeEvent({ params: { projectId: PROJECT.id } }))) as {
      version: number
      publishedAt: Date | null
      paths: { json: string; css: string }
    }

    // Version bumped to 1 (no prior published rows).
    expect(res.version).toBe(1)
    expect(res.paths.json).toBe(`p/${PROJECT.id}/current.json`)

    // Four storage uploads: v1.json, v1.css, current.json, current.css.
    expect(spies.storage).toHaveLength(4)
    const keys = spies.storage.map((s) => s.key)
    expect(keys).toEqual([
      `p/${PROJECT.id}/v1/tokens.json`,
      `p/${PROJECT.id}/v1/tokens.css`,
      `p/${PROJECT.id}/current.json`,
      `p/${PROJECT.id}/current.css`,
    ])

    // active_version pointer inserted (or upserted).
    expect(spies.inserts).toHaveLength(1)
    expect(spies.inserts[0].table).toBe('active_version')

    // Audit emitted with the right action + version.
    expect(spies.audit).toHaveLength(1)
    expect(spies.audit[0].action).toBe('config.published')
    expect(spies.audit[0].payload).toMatchObject({
      organizationId: ORG.id,
      targetType: 'project',
      targetId: PROJECT.id,
      after: { version: 1 },
    })

    // Bunny purge dispatched for the project.
    expect(spies.bunnyPurges).toEqual([PROJECT.id])
  })

  it('picks the next version number above the existing max', async () => {
    published.push({
      id: 'v3',
      projectId: PROJECT.id,
      version: 3,
      status: 'published',
      tokensJson: {},
      publishedAt: new Date(),
      publishedBy: SESSION.user.id,
      createdAt: new Date(),
    })
    draft.push({
      id: 'draft-1',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: { colors: {} },
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date(),
    })

    const res = (await handler(fakeEvent({ params: { projectId: PROJECT.id } }))) as {
      version: number
    }

    expect(res.version).toBe(4)
    expect(spies.storage[0].key).toBe(`p/${PROJECT.id}/v4/tokens.json`)
  })

  it('rejects when requireProjectAccess throws (insufficient role)', async () => {
    const err = new Error('Forbidden') as Error & { statusCode: number }
    err.statusCode = 403
    requireProjectAccess.mockRejectedValue(err)

    await expect(handler(fakeEvent({ params: { projectId: PROJECT.id } }))).rejects.toMatchObject({
      statusCode: 403,
    })

    // No side effects on auth failure.
    expect(spies.storage).toHaveLength(0)
    expect(spies.audit).toHaveLength(0)
    expect(spies.bunnyPurges).toHaveLength(0)
  })

  it('promotes brand-assets draft blobs to versioned + current alongside tokens', async () => {
    draft.push({
      id: 'draft-2',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: {
        colors: { primary: '#0059b3' },
        assets: { logo: { file: 'logo.svg', type: 'svg' } },
        typography: {
          webFont: {
            source: 'custom',
            family: 'Asp Grotesk',
            weights: [400, 700],
            files: { '400': 'fonts/asp-grotesk-400.woff2', '700': 'fonts/asp-grotesk-700.woff2' },
          },
        },
      },
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date('2026-08-04T10:00:00Z'),
    })

    await handler(fakeEvent({ params: { projectId: PROJECT.id } }))

    const keys = spies.storage.map((o) => o.key)
    // Fase B: draft → immutabelt arkiv
    expect(keys).toContain(`p/${PROJECT.id}/v1/logo.svg`)
    expect(keys).toContain(`p/${PROJECT.id}/v1/fonts/asp-grotesk-400.woff2`)
    expect(keys).toContain(`p/${PROJECT.id}/v1/fonts/asp-grotesk-700.woff2`)
    // Fase C: arkiv → current (det /k serverer)
    expect(keys).toContain(`p/${PROJECT.id}/current/logo.svg`)
    expect(keys).toContain(`p/${PROJECT.id}/current/fonts/asp-grotesk-400.woff2`)
    // Kilderne er copies, ikke re-uploads gennem app-processen
    const v1Logo = spies.storage.find((o) => o.key === `p/${PROJECT.id}/v1/logo.svg`)
    expect(v1Logo?.bodyPreview).toBe(`copy:p/${PROJECT.id}/draft/logo.svg`)
    expect(v1Logo?.contentType).toBe('image/svg+xml')
    const currentLogo = spies.storage.find((o) => o.key === `p/${PROJECT.id}/current/logo.svg`)
    expect(currentLogo?.bodyPreview).toBe(`copy:p/${PROJECT.id}/v1/logo.svg`)
    // 4 token-writes + 3 arkiv-copies + 3 current-copies
    expect(spies.storage).toHaveLength(10)
  })
})
