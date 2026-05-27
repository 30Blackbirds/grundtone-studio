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
}

const drafts: DraftRow[] = []

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: () => null,
  desc: () => null,
  eq: () => null,
  max: () => null,
}))

// The handlers do db.select() — config.post does max + draft + update/insert,
// config.get does draft + activeVersion + active row. Branch on what was
// selected via the column list.
const dbMock = {
  select: (cols?: Record<string, unknown>) => {
    const isMaxQuery = cols && 'value' in cols
    return {
      from: () => ({
        where: () => {
          if (isMaxQuery) {
            const max = drafts.reduce((m, r) => Math.max(m, r.version), 0)
            return Promise.resolve([{ value: max === 0 ? null : max }])
          }
          return {
            orderBy: () => ({
              limit: () => Promise.resolve(drafts.slice(0, 1)),
            }),
            // active_version + active config_version lookups: no orderBy.
            then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
          }
        },
      }),
    }
  },
  update: () => ({
    set: (s: Record<string, unknown>) => {
      spies.updates.push({ table: 'config_version', set: s })
      return {
        where: () => ({
          returning: () => Promise.resolve([{ ...drafts[0], ...s }]),
        }),
      }
    },
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      spies.inserts.push({ table: 'config_version', values: v })
      return {
        returning: () => Promise.resolve([{ id: 'new-1', ...v }]),
      }
    },
  }),
}
vi.mock('~~/server/db', () => ({ db: dbMock }))
vi.mock('~~/server/db/schema', () => ({
  configVersion: { _: { name: 'config_version' } },
  activeVersion: { _: { name: 'active_version' } },
}))

vi.mock('~~/server/lib/tokens', () => ({
  tokensSchema: {
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
  DEFAULT_TOKENS: { colors: { primary: '#4F46E5' } },
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const postHandler = (await import('./config.post')).default as unknown as (
  event: unknown,
) => Promise<unknown>
const getHandler = (await import('./config.get')).default as unknown as (
  event: unknown,
) => Promise<unknown>

beforeEach(() => {
  spies.inserts.length = 0
  spies.updates.length = 0
  drafts.length = 0
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

describe('POST /api/projects/[projectId]/config', () => {
  const tokens = { colors: { primary: '#10B981' } }

  it('400s when projectId is missing', async () => {
    await expect(postHandler(fakeEvent({ body: tokens }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('inserts a new draft when none exists', async () => {
    drafts.length = 0
    await postHandler(fakeEvent({ params: { projectId: PROJECT.id }, body: tokens }))

    expect(spies.inserts).toHaveLength(1)
    expect(spies.inserts[0].values).toMatchObject({
      projectId: PROJECT.id,
      version: 1,
      tokensJson: tokens,
      status: 'draft',
    })
    expect(spies.updates).toHaveLength(0)
  })

  it('updates the existing draft instead of creating a new one', async () => {
    drafts.push({
      id: 'draft-1',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: { colors: { primary: '#000000' } },
      publishedAt: null,
    })
    await postHandler(fakeEvent({ params: { projectId: PROJECT.id }, body: tokens }))

    expect(spies.updates).toHaveLength(1)
    expect(spies.updates[0].set).toMatchObject({ tokensJson: tokens })
    expect(spies.inserts).toHaveLength(0)
  })

  it('400s when tokens fail validation', async () => {
    // Re-mock tokensSchema for this case only via the inner safeParse return.
    const { tokensSchema } = await import('~~/server/lib/tokens')
    vi.spyOn(tokensSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: { issues: [{ message: 'bad input' }] },
    } as never)
    await expect(
      postHandler(fakeEvent({ params: { projectId: PROJECT.id }, body: tokens })),
    ).rejects.toMatchObject({ statusCode: 400, message: 'bad input' })
  })

  it('rejects on insufficient role (editor required)', async () => {
    const err = new Error('Forbidden') as Error & { statusCode: number }
    err.statusCode = 403
    requireProjectAccess.mockRejectedValue(err)
    await expect(
      postHandler(fakeEvent({ params: { projectId: PROJECT.id }, body: tokens })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET /api/projects/[projectId]/config', () => {
  it('returns the draft + null active + DEFAULT_TOKENS when nothing is published', async () => {
    drafts.push({
      id: 'draft-1',
      projectId: PROJECT.id,
      version: 2,
      status: 'draft',
      tokensJson: { colors: { primary: '#0EA5E9' } },
      publishedAt: null,
    })

    const res = (await getHandler(fakeEvent({ params: { projectId: PROJECT.id } }))) as {
      draft: { version: number } | null
      active: unknown
      defaults: unknown
    }

    expect(res.draft?.version).toBe(2)
    expect(res.active).toBeNull()
    expect(res.defaults).toMatchObject({ colors: { primary: '#4F46E5' } })
  })

  it('returns draft=null when no draft exists', async () => {
    drafts.length = 0
    const res = (await getHandler(fakeEvent({ params: { projectId: PROJECT.id } }))) as {
      draft: unknown
    }
    expect(res.draft).toBeNull()
  })
})
