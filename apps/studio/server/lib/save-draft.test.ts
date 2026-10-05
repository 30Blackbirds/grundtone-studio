import { describe, it, expect, vi, beforeEach } from 'vitest'

// First cells for the ONE way a draft is written (869fbuf68). It had none, and
// it is where the audit event for BOTH doors lives — config.post.ts and
// tokens/import.post.ts delegate here. So `config.draft_saved` was proven
// nowhere, and writing endpoint cells that only assert the delegation would
// have left it that way.
//
// 🔴 diffTokens IS THE REAL ONE. Mocking it would make the path-count and
// path-capping cells below measure my own stub instead of the diff the audit
// row actually reports.

vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ op: 'and', p }),
  desc: (c: unknown) => ({ op: 'desc', c }),
  eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
  max: (c: unknown) => ({ op: 'max', c }),
}))

let existingDraft: Record<string, unknown> | undefined
let maxVersion: number | null = null
const ops: string[] = []
vi.mock('~~/server/db', () => ({
  db: {
    select: (shape?: unknown) => ({
      from: () => ({
        where: () => {
          // insertDraft's max() query selects a shape; the draft lookup does not.
          if (shape) return Promise.resolve([{ value: maxVersion }])
          return {
            orderBy: () => ({ limit: () => Promise.resolve(existingDraft ? [existingDraft] : []) }),
          }
        },
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            ops.push('update')
            return Promise.resolve([{ ...existingDraft, ...vals }])
          },
        }),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          ops.push('insert')
          return Promise.resolve([{ id: 'cv-new', ...vals }])
        },
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  configVersion: {
    id: 'id',
    projectId: 'projectId',
    status: 'status',
    createdAt: 'createdAt',
    version: 'version',
  },
}))

const auditEvents: Array<Record<string, unknown>> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, payload: Record<string, unknown>) => {
    // Captured AFTER the row ops, so `ops` at this moment says what had already
    // run — that is how the ordering cell below is measured.
    auditEvents.push({ ...payload, opsAtAuditTime: [...ops] })
    return Promise.resolve()
  },
}))

const { saveDraft } = await import('./save-draft')

const ACCESS = { organization: { id: 'org-1' }, project: { name: 'Acme' }, userId: 'user-1' }
const PROJECT_ID = 'p-1'
const save = (tokens: unknown, options?: { source?: 'dtcg-import' }) =>
  saveDraft(null as never, ACCESS, PROJECT_ID, tokens as never, options)

beforeEach(() => {
  existingDraft = undefined
  maxVersion = null
  ops.length = 0
  auditEvents.length = 0
})

describe('saving a draft writes the audit event', () => {
  it('🔴 records config.draft_saved against the project, with its name as the label', async () => {
    await save({ colors: { primary: '#000000' } })
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      action: 'config.draft_saved',
      organizationId: 'org-1',
      targetType: 'project',
      targetId: PROJECT_ID,
      targetLabel: 'Acme',
    })
  })

  it('says created=true for a new draft and created=false for an upsert', async () => {
    // The pair. Either cell alone passes on a handler that hardcodes its answer.
    await save({ colors: { primary: '#000000' } })
    expect(auditEvents[0]!.after).toMatchObject({ created: true })

    ops.length = 0
    auditEvents.length = 0
    existingDraft = { id: 'cv-1', version: 7, tokensJson: {} }
    await save({ colors: { primary: '#111111' } })
    expect(auditEvents[0]!.after).toMatchObject({ created: false, version: 7 })
    expect(ops).toEqual(['update'])
  })

  it('numbers the first draft version 1 when the project has none', async () => {
    maxVersion = null
    await save({ colors: { primary: '#000000' } })
    expect(auditEvents[0]!.after).toMatchObject({ version: 1 })
  })

  it('is written only AFTER the row is stored', async () => {
    // The header promises a rejected save produces no event. The ordering is
    // what makes that true, so it is measured rather than trusted: at audit
    // time the insert had already run.
    await save({ colors: { primary: '#000000' } })
    expect(auditEvents[0]!.opsAtAuditTime).toEqual(['insert'])
  })
})

describe('🔴 the audit row carries PATHS, never VALUES', () => {
  it('names the changed paths and does not leak a single token value', async () => {
    // The file's own header requires this ("never their values"). A payload that
    // grew to include values would still satisfy every other cell here, so this
    // one provokes it: a value distinctive enough that its presence anywhere in
    // the serialised row is unambiguous.
    existingDraft = { id: 'cv-1', version: 3, tokensJson: { colors: { primary: '#000000' } } }
    await save({ colors: { primary: '#DEADBE' } })

    const after = auditEvents[0]!.after as Record<string, unknown>
    expect(after.changedPaths).toEqual(expect.arrayContaining([expect.stringContaining('color')]))
    expect(JSON.stringify(auditEvents[0])).not.toContain('#DEADBE')
    expect(JSON.stringify(auditEvents[0])).not.toContain('#000000')
  })

  it('🔴 caps the path LIST at 50 while the COUNT stays complete', async () => {
    // The cap exists so a big import cannot write an unbounded audit row. The
    // danger is capping the count along with the list: the row would then say
    // "50 paths changed" when 60 did, and nothing downstream could tell a
    // truncated row from a complete one.
    const previous: Record<string, string> = {}
    const next: Record<string, string> = {}
    for (let i = 0; i < 60; i += 1) {
      previous[`t${i}`] = 'a'
      next[`t${i}`] = 'b'
    }
    existingDraft = { id: 'cv-1', version: 2, tokensJson: previous }
    await save(next)

    const after = auditEvents[0]!.after as { changedPathCount: number; changedPaths: string[] }
    expect(after.changedPathCount).toBe(60)
    expect(after.changedPaths).toHaveLength(50)
  })
})

describe('the source is recorded only when the caller names one', () => {
  it('carries source=dtcg-import when passed', async () => {
    await save({ colors: { primary: '#000000' } }, { source: 'dtcg-import' })
    expect(auditEvents[0]!.after).toMatchObject({ source: 'dtcg-import' })
  })

  it('omits the key entirely for an ordinary editor save, rather than sending undefined', async () => {
    // `...(source ? { source } : {})` vs `{ source: undefined }` are different
    // rows once serialised, and an audit reader that branches on key presence
    // would read the second as "source was recorded as nothing".
    await save({ colors: { primary: '#000000' } })
    expect(Object.keys(auditEvents[0]!.after as object)).not.toContain('source')
  })
})
