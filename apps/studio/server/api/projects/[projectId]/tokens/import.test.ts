import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSpies,
  fakeEvent,
  mockH3,
  PROJECT,
  ORG,
  SESSION,
} from '~~/tests/helpers/endpoint-fixtures'

// Cells for the DTCG import endpoint (riff KH-1044, I1–I4). The mapping itself
// is pinned in packages/dtcg (round trip + the official fixture suite); what is
// measured HERE is the endpoint's own promises: the role it demands, that a dry
// run writes NOTHING, that a commit writes a DRAFT and never publishes, that the
// audit event carries the source marker, and that the merge leaves groups the
// file did not carry alone.

const spies = createSpies()

interface DraftRow {
  id: string
  projectId: string
  version: number
  status: 'draft' | 'published'
  tokensJson: Record<string, unknown>
}
const drafts: DraftRow[] = []

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: () => null,
  desc: () => null,
  eq: () => null,
  max: () => null,
}))

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
          return { orderBy: () => ({ limit: () => Promise.resolve(drafts.slice(0, 1)) }) }
        },
      }),
    }
  },
  update: () => ({
    set: (s: Record<string, unknown>) => {
      spies.updates.push({ table: 'config_version', set: s })
      return { where: () => ({ returning: () => Promise.resolve([{ ...drafts[0], ...s }]) }) }
    },
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      spies.inserts.push({ table: 'config_version', values: v })
      return { returning: () => Promise.resolve([{ id: 'new-1', ...v }]) }
    },
  }),
}
vi.mock('~~/server/db', () => ({ db: dbMock }))
vi.mock('~~/server/db/schema', () => ({ configVersion: { _: { name: 'config_version' } } }))

const auditEvents: Array<Record<string, unknown>> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: Record<string, unknown>) => {
    auditEvents.push(payload)
    return Promise.resolve()
  },
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const handler = (await import('./import.post')).default as unknown as (event: unknown) => Promise<{
  saved: boolean
  version?: number
  report: { total: number; mapped: unknown[]; invalid: unknown[]; overwritten: number }
  tokens: Record<string, unknown>
}>

const color = (hex: [number, number, number]) => ({
  $type: 'color',
  $value: { colorSpace: 'srgb', components: hex },
})
const BASE = {
  $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
  color: { primary: color([0, 0, 0]) },
  spacing: { md: { $type: 'dimension', $value: { value: 16, unit: 'px' } } },
}

beforeEach(() => {
  spies.inserts.length = 0
  spies.updates.length = 0
  drafts.length = 0
  auditEvents.length = 0
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'editor',
    source: 'org',
    orgRole: 'owner',
    projectRole: null,
  })
})

describe('POST /api/projects/[projectId]/tokens/import', () => {
  it('400s without a projectId', async () => {
    await expect(handler(fakeEvent({ body: { base: BASE } }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('demands editor, the same level as saving the config (I1)', async () => {
    await handler(
      fakeEvent({ params: { projectId: PROJECT.id }, body: { base: BASE, dryRun: true } }),
    )
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id, 'editor')
  })

  // 🔴 THE CLAIM THIS CELL MAY MAKE, corrected after [sikkerhed] read it on
  // #319. fakeEvent hands the handler an ALREADY PARSED object, so this cell
  // cannot say anything about raw bodies, bytes on the wire, or "before
  // parsing". What it measures is the ceiling on the parsed document, and that
  // the refusal happens before any write.
  it('refuses an oversized parsed document, and writes nothing', async () => {
    const huge = {
      color: Object.fromEntries([...Array(60_000)].map((_, i) => [`c${i}`, color([0, 0, 0])])),
    }
    await expect(
      handler(fakeEvent({ params: { projectId: PROJECT.id }, body: { base: huge } })),
    ).rejects.toMatchObject({ statusCode: 413 })
    expect(spies.inserts).toHaveLength(0)
    expect(spies.updates).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  // The defect: a 30 KB document nested 5000 deep — 1.5 % of the size ceiling —
  // made the parser throw RangeError, so the endpoint answered 500 on an
  // unhandled exception. A refused file must be a 4xx with a reason.
  const deeplyNested = () => {
    const root: Record<string, unknown> = {}
    let node = root
    for (let i = 0; i < 5000; i++) {
      const child: Record<string, unknown> = {}
      node[`g${i}`] = child
      node = child
    }
    node.token = color([0, 0, 0])
    return root
  }

  it('refuses a deeply nested document with a 4xx, not a 500, and writes nothing', async () => {
    const root = deeplyNested()
    expect(JSON.stringify(root).length).toBeLessThan(200_000)
    const error = (await handler(
      fakeEvent({ params: { projectId: PROJECT.id }, body: { base: root } }),
    ).then(
      () => null,
      (e: unknown) => e,
    )) as { statusCode?: number; statusMessage?: string } | null
    expect(error).not.toBeNull()
    // 🔴 NAMING THE BRANCH, not just the status class. Measured: with the depth
    // bound removed, this cell still passed — the catch below turned the
    // RangeError into a 400, so "4xx" could not tell a BOUNDED refusal from a
    // CAUGHT crash. The message distinguishes them: the bound produces a
    // structural-error refusal, the catch produces "could not be read".
    expect(error!.statusCode).toBe(400)
    expect(error!.statusMessage).toContain('structural error')
    expect(spies.inserts).toHaveLength(0)
    expect(spies.updates).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  it('a dry run of the same document is refused too, never reported as an empty but fine file', async () => {
    const res = (await handler(
      fakeEvent({
        params: { projectId: PROJECT.id },
        body: { base: deeplyNested(), dryRun: true },
      }),
    ).catch((e: unknown) => e)) as {
      statusCode?: number
      report?: { parseErrors: unknown[] }
    }
    expect(
      (res.statusCode !== undefined && res.statusCode < 500) ||
        (res.report?.parseErrors.length ?? 0) > 0,
    ).toBe(true)
  })
})

describe('dryRun writes nothing (I2)', () => {
  it('returns the report and touches neither table nor audit', async () => {
    const res = await handler(
      fakeEvent({ params: { projectId: PROJECT.id }, body: { base: BASE, dryRun: true } }),
    )
    expect(res.saved).toBe(false)
    expect(res.version).toBeUndefined()
    expect(res.report.total).toBe(2)
    expect(spies.inserts).toHaveLength(0)
    expect(spies.updates).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  it('still reports what a commit would overwrite (I4)', async () => {
    drafts.push({
      id: 'd1',
      projectId: PROJECT.id,
      version: 3,
      status: 'draft',
      tokensJson: { colors: { primary: '#ff0000' } },
    })
    const res = await handler(
      fakeEvent({ params: { projectId: PROJECT.id }, body: { base: BASE, dryRun: true } }),
    )
    expect(res.report.overwritten).toBe(1)
    expect(spies.updates).toHaveLength(0)
  })
})

describe('a commit saves a DRAFT (I3)', () => {
  it('inserts a draft, never a published row, and marks the source', async () => {
    const res = await handler(
      fakeEvent({ params: { projectId: PROJECT.id }, body: { base: BASE } }),
    )
    expect(res.saved).toBe(true)
    expect(spies.inserts).toHaveLength(1)
    const inserted = spies.inserts[0]!.values as Record<string, unknown>
    expect(inserted).toMatchObject({ status: 'draft' })
    expect(inserted.status).not.toBe('published')
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      action: 'config.draft_saved',
      after: { source: 'dtcg-import' },
    })
  })

  it('upserts the existing draft instead of making a second one', async () => {
    drafts.push({
      id: 'd1',
      projectId: PROJECT.id,
      version: 3,
      status: 'draft',
      tokensJson: { colors: { primary: '#ff0000' } },
    })
    await handler(fakeEvent({ params: { projectId: PROJECT.id }, body: { base: BASE } }))
    expect(spies.inserts).toHaveLength(0)
    expect(spies.updates).toHaveLength(1)
  })

  it('leaves groups the file did not carry exactly as they were (I4)', async () => {
    drafts.push({
      id: 'd1',
      projectId: PROJECT.id,
      version: 3,
      status: 'draft',
      tokensJson: {
        // `secondary`, not an invented name: tokensSchema strips unknown keys
        // inside a group, so an invalid slot would have made this cell pass for
        // the wrong reason.
        colors: { primary: '#ff0000', secondary: '#00ff00' },
        radius: { sm: '4px' },
      },
    })
    await handler(fakeEvent({ params: { projectId: PROJECT.id }, body: { base: BASE } }))
    const saved = (spies.updates[0]!.set as Record<string, unknown>).tokensJson as Record<
      string,
      Record<string, string>
    >
    expect(saved.colors).toEqual({ primary: '#000000', secondary: '#00ff00' })
    expect(saved.radius).toEqual({ sm: '4px' })
    expect(saved.spacing).toEqual({ md: '16px' })
  })

  it('refuses a structurally broken file and writes nothing', async () => {
    const broken = { color: { primary: { $type: 'color', $value: '{nowhere}' } } }
    await expect(
      handler(fakeEvent({ params: { projectId: PROJECT.id }, body: { base: broken } })),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(spies.inserts).toHaveLength(0)
    expect(spies.updates).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })
})
