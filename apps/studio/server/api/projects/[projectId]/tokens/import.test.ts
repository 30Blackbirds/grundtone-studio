import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAX_DEPTH } from '@grundtone-studio/dtcg'
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

/** Counts db.select calls, so a cell can say a guard refused BEFORE any DB access. */
const dbReads = { selects: 0 }
const dbMock = {
  select: (cols?: Record<string, unknown>) => {
    dbReads.selects++
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
  dbReads.selects = 0
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
  // Every refusal below is measured the same way: the status, the branch that
  // produced it, nothing written, and no DB read (the guards run first).
  type Refusal = { statusCode?: number; statusMessage?: string; data?: { code?: string } }
  const refusalOf = async (body: Record<string, unknown>) =>
    (await handler(fakeEvent({ params: { projectId: PROJECT.id }, body })).then(
      () => null,
      (e: unknown) => e,
    )) as Refusal | null
  const nothingTouched = () => {
    expect(spies.inserts).toHaveLength(0)
    expect(spies.updates).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
    expect(dbReads.selects).toBe(0)
  }

  it('refuses a flat but oversized parsed document with 413 from the size ceiling', async () => {
    // FLAT: two nodes, so checkBounds passes it and only the ceiling can say no.
    const huge = { color: { $description: 'x'.repeat(2_100_000) } }
    const error = await refusalOf({ base: huge })
    expect(error?.statusCode).toBe(413)
    expect(error?.statusMessage).toContain('larger than 2000000 serialized units')
    expect(error?.statusMessage).not.toContain('could not be measured')
    nothingTouched()
  })

  // The defect: a 30 KB document nested 5000 deep — 1.5 % of the size ceiling —
  // made the parser throw RangeError, so the endpoint answered 500 on an
  // unhandled exception. A refused file must be a 4xx with a reason.
  const deeplyNested = (depth = 5000) => {
    const root: Record<string, unknown> = {}
    let node = root
    for (let i = 0; i < depth; i++) {
      const child: Record<string, unknown> = {}
      node[`g${i}`] = child
      node = child
    }
    node.token = color([0, 0, 0])
    return root
  }
  /** `{ a: [[[ … ]]] }`: the same depth made of ARRAYS. */
  const deeplyNestedArrays = (depth = 5000) => {
    let node: unknown = []
    for (let i = 1; i < depth; i++) node = [node]
    return { a: node }
  }
  /** Plain nested objects, exactly `depth` levels deep as checkBounds counts them. */
  const nestedTo = (depth: number) => {
    let node: Record<string, unknown> = {}
    for (let i = 1; i < depth; i++) node = { g: node }
    return node
  }

  // The serialised length of a `deeplyNested()` document, measured WITHOUT
  // recursion. 🔴 `JSON.stringify` of 5000 levels is itself a recursive walker:
  // on Linux (node 24.20.0, arm64) it overflowed the stack on the sanity line,
  // before the handler ran. The same fix as packages/dtcg's parse.test.ts (#378).
  const jsonLength = (document: Record<string, unknown>) => {
    let length = 0
    let node = document
    for (;;) {
      const key = Object.keys(node).find((k) => /^g\d+$/.test(k))
      // The innermost group holds only the token: shallow, safe to stringify.
      if (key === undefined) return length + JSON.stringify(node).length
      // `{` + `"key"` + `:` + child + `}`
      length += 1 + JSON.stringify(key).length + 1 + 1
      node = node[key] as Record<string, unknown>
    }
  }

  it('measures a deep document the way JSON.stringify does (control for jsonLength)', () => {
    for (const depth of [0, 1, 10, 500]) {
      expect(jsonLength(deeplyNested(depth))).toBe(JSON.stringify(deeplyNested(depth)).length)
    }
  })

  it('refuses a deeply nested document with 400 too_deep, not a 500, and writes nothing', async () => {
    const root = deeplyNested()
    expect(jsonLength(root)).toBeLessThan(200_000)
    const error = await refusalOf({ base: root })
    expect(error).not.toBeNull()
    // 🔴 NAMING THE BRANCH, not just the status class. A 4xx alone cannot tell
    // the BOUND's refusal from a CAUGHT crash: the old size check caught a
    // RangeError from JSON.stringify and answered 413 "could not be measured"
    // on Linux, and the import catch answers 400 "could not be read". The code
    // is the bound's own.
    expect(error!.statusCode).toBe(400)
    expect(error!.data?.code).toBe('too_deep')
    expect(error!.statusMessage).not.toContain('could not be measured')
    expect(error!.statusMessage).not.toContain('could not be read')
    nothingTouched()
  })

  it('refuses a deeply nested document made of ARRAYS with 400 too_deep', async () => {
    const error = await refusalOf({ base: deeplyNestedArrays() })
    expect(error?.statusCode).toBe(400)
    expect(error?.data?.code).toBe('too_deep')
    expect(error?.statusMessage).not.toContain('could not be measured')
    nothingTouched()
  })

  it('refuses a document with more than MAX_NODES nodes with 400 too_many_nodes', async () => {
    const wide = { color: Object.fromEntries([...Array(200_010)].map((_, i) => [`c${i}`, {}])) }
    const error = await refusalOf({ base: wide })
    expect(error?.statusCode).toBe(400)
    expect(error?.data?.code).toBe('too_many_nodes')
    expect(error?.statusMessage).not.toContain('could not be measured')
    nothingTouched()
  })

  it('checks the dark file against the same bounds', async () => {
    const error = await refusalOf({ base: BASE, dark: deeplyNested() })
    expect(error?.statusCode).toBe(400)
    expect(error?.data?.code).toBe('too_deep')
    expect(error?.statusMessage).toContain('the dark document')
    nothingTouched()
  })

  it('the bound is not vacuous: exactly MAX_DEPTH passes it, one more does not', async () => {
    const atLimit = await refusalOf({ base: nestedTo(MAX_DEPTH), dryRun: true })
    expect(atLimit?.data?.code).not.toBe('too_deep')
    const overLimit = await refusalOf({ base: nestedTo(MAX_DEPTH + 1), dryRun: true })
    expect(overLimit?.data?.code).toBe('too_deep')
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
