import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG } from '~~/tests/helpers/endpoint-fixtures'

// Last of the six (869fbuf68). The audit for this door lives in
// lib/save-draft.ts and is measured there; what is measured HERE is the door —
// the trust boundary around a FOREIGN document, and the promise that a dry run
// writes nothing.
//
// 🔴 importTokens, mergeTokens AND tokensSchema ARE THE REAL ONES. The whole
// subject is what happens to a document nobody here wrote, so a mocked mapper
// would measure my own idea of the mapping instead of the mapping.

vi.mock('h3', () => mockH3())
vi.stubGlobal('defineRouteMeta', () => {})
vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ op: 'and', p }),
  desc: (c: unknown) => ({ op: 'desc', c }),
  eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
}))

let draftRow: Record<string, unknown> | undefined
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(draftRow ? [draftRow] : []) }),
        }),
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  configVersion: { projectId: 'projectId', status: 'status', createdAt: 'createdAt' },
}))

const saveDraft = vi.fn()
vi.mock('~~/server/lib/save-draft', () => ({ saveDraft: (...a: unknown[]) => saveDraft(...a) }))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...a: unknown[]) => requireProjectAccess(...a),
}))

const mod = await import('./import.post')
const handler = mod.default as unknown as (e: unknown) => Promise<Record<string, unknown>>
const { mergeTokens } = mod as unknown as {
  mergeTokens: (c: Record<string, unknown>, i: Record<string, unknown>) => Record<string, unknown>
}

/** A minimal DTCG 2025.10 document carrying one colour.
 *
 * 🔴 `$value` IS AN OBJECT, NOT A HEX STRING. Measured from the dtcg package's
 * own tests after a hex fixture failed four cells — including the POSITIVE
 * CONTROL, which is what told me the fixture was wrong rather than the mapper.
 * In DTCG 2025.10 a colour is `{ colorSpace, components }`, and a STRING is
 * read as a reference (the package's broken-reference case is `'{nowhere}'`).
 */
const dtcg = (slot: string, components = [0.04, 0.49, 1]) => ({
  color: { [slot]: { $type: 'color', $value: { colorSpace: 'srgb', components } } },
})

const imp = (body: unknown) => handler(fakeEvent({ params: { projectId: PROJECT.id }, body }))

beforeEach(() => {
  draftRow = undefined
  saveDraft.mockReset()
  saveDraft.mockResolvedValue({ id: 'cv-9', version: 3 })
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    project: PROJECT,
    organization: ORG,
    role: 'editor',
    userId: 'user-1',
  })
})

describe('importing a DTCG document', () => {
  it('requires EDITOR', async () => {
    await imp({ base: dtcg('primary'), dryRun: true })
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id, 'editor')
  })

  it('🔴 a DRY RUN writes nothing at all', async () => {
    // The promise the UI is built on: the report screen is reachable without
    // committing. Measured as "saveDraft was not called", not as a response
    // field — a handler that saved and then reported saved:false would satisfy
    // the field and break the promise.
    const res = await imp({ base: dtcg('primary'), dryRun: true })
    expect(res.saved).toBe(false)
    expect(res.version).toBeUndefined()
    expect(saveDraft).not.toHaveBeenCalled()
    expect(res.report).toBeDefined()
  })

  it('a commit delegates to saveDraft, carrying source=dtcg-import', async () => {
    // The audit itself belongs to save-draft.ts and is asserted there. What
    // matters here is that this door is distinguishable in the audit row from
    // the ordinary editor save — otherwise an imported draft and a hand-edited
    // one are the same event.
    const res = await imp({ base: dtcg('primary'), dryRun: false })
    expect(saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      PROJECT.id,
      expect.anything(),
      { source: 'dtcg-import' },
    )
    expect(res).toMatchObject({ saved: true, version: 3 })
  })

  it('400s on a body with no base document, before any read', async () => {
    await expect(imp({ dryRun: true })).rejects.toMatchObject({ statusCode: 400 })
    expect(saveDraft).not.toHaveBeenCalled()
  })
})

describe('🔴 a foreign document may not produce a 500', () => {
  it('refuses a self-referential document by its bound, never by a crashed stringify', async () => {
    // A cycle would make JSON.stringify throw. checkBounds runs first and is
    // iterative: every lap round the cycle is one level deeper, so it passes
    // MAX_DEPTH (long before MAX_NODES) and answers with the bound's own code;
    // the size check never sees it. Measured: too_deep, not too_many_nodes.
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(imp({ base: cyclic, dryRun: true })).rejects.toMatchObject({
      statusCode: 400,
      data: { code: 'too_deep' },
      statusMessage: expect.stringContaining('the base document'),
    })
  })

  it('413s an oversized document and names the DARK file when that is the big one', async () => {
    // The loop runs over both documents, so the message must identify which —
    // a 413 that says only "too large" sends the person back to re-upload the
    // wrong file.
    const big = {
      color: Object.fromEntries(
        Array.from({ length: 60_000 }, (_, i) => [`c${i}`, { $type: 'color', $value: '#000000' }]),
      ),
    }
    await expect(imp({ base: dtcg('primary'), dark: big, dryRun: true })).rejects.toMatchObject({
      statusCode: 413,
      statusMessage: expect.stringContaining('dark'),
    })
  })

  it('refuses a committed import whose document has structural errors', async () => {
    // And the pair that makes it meaningful: the same document is REPORTABLE.
    // A dry run must still return its parseErrors so the person can see what is
    // wrong, while a commit refuses.
    // The package's own broken case: a reference that resolves nowhere. My
    // first guess — a missing $value — produced ZERO parseErrors, so it was not
    // measuring the branch at all.
    const broken = { color: { primary: { $type: 'color', $value: '{nowhere}' } } }
    const dry = await imp({ base: broken, dryRun: true })
    expect((dry.report as { parseErrors: unknown[] }).parseErrors.length).toBeGreaterThan(0)
    await expect(imp({ base: broken, dryRun: false })).rejects.toMatchObject({ statusCode: 400 })
    expect(saveDraft).not.toHaveBeenCalled()
  })
})

describe('🔴 the merge is group-wise — a colour file must not erase the spacing scale', () => {
  it('leaves a group the incoming file did not carry exactly as it was', async () => {
    const current = { colors: { primary: '#111111' }, spacing: { md: '16px' } }
    const merged = mergeTokens(current, { colors: { secondary: '#222222' } })
    expect(merged).toMatchObject({
      colors: { primary: '#111111', secondary: '#222222' },
      spacing: { md: '16px' },
    })
  })

  it('merges dark colours without dropping the light ones', async () => {
    const merged = mergeTokens(
      { colors: { primary: '#111111' }, dark: { colors: { primary: '#eeeeee' } } },
      { dark: { colors: { secondary: '#dddddd' } } },
    )
    expect(merged).toMatchObject({
      colors: { primary: '#111111' },
      dark: { colors: { primary: '#eeeeee', secondary: '#dddddd' } },
    })
  })

  it('merges typography sub-groups independently', async () => {
    const merged = mergeTokens(
      { typography: { fontFamily: { base: 'Inter' }, slots: { heading: { source: 'curated' } } } },
      { typography: { fontFamily: { mono: 'Mono' } } },
    )
    expect(merged.typography).toMatchObject({
      fontFamily: { base: 'Inter', mono: 'Mono' },
      slots: { heading: { source: 'curated' } },
    })
  })
})

describe('🔴 869fbzc8a ANSWERED, and the answer is the bad one', () => {
  it('a misspelled slot is reported as MAPPED, then silently dropped on save', async () => {
    // THE OPEN QUESTION IN THAT TASK WAS WHETHER THE MAPPER FILTERS TO
    // COLOR_SLOTS FIRST. It does not. Measured in four steps on one document
    // carrying `color.primaryLigt` (a typo for primaryLight):
    //
    //   report.mapped      ['color.primaryLigt']   <- claims success
    //   report.notMapped   []                      <- says nothing is wrong
    //   mapper output      colors: { primaryLigt } <- value is carried
    //   after tokensSchema colors: {}              <- value is GONE
    //
    // 🔴 THE CAUSE IS THE ABSENCE OF `.strict()`, NOT THE PRESENCE OF
    // `.partial()` — corrected after [projektleder] read the source. Measured
    // directly: `z.object` STRIPS unknown keys by default, with and without
    // `.partial()`; only `.strict()` refuses. `.partial()` merely makes the
    // declared slots optional and has nothing to do with the loss. Wording it
    // as "`.partial()` instead of `.strict()`" invites someone to delete the
    // `.partial()` and believe it is fixed.
    //
    // The asymmetry is visible in tokens.ts: the `dark` wrapper (l.283) and
    // tokensSchema itself ARE `.strict()`, so the outer layers refuse unknown
    // keys while the inner colour group drops them. The result is user-visible
    // and worse than either half
    // alone: the DRY RUN shows the value and reports it mapped, the COMMIT
    // succeeds with no error, and the saved draft contains nothing. The preview
    // and the saved result disagree, and the report actively claims success.
    //
    // 🔴 THIS CELL ASSERTS THE DEFECT, NOT THE CURE. It is here so the
    // behaviour cannot drift unnoticed and so a fix turns it RED — when it
    // does, delete it and assert the cure instead. Filed on 869fbzc8a with this
    // measurement; the task's "not measured" caveat is now closed.
    const res = await imp({ base: dtcg('primaryLigt'), dryRun: true })
    const report = res.report as { mapped: Array<{ path: string }>; notMapped: unknown[] }
    const tokens = res.tokens as { colors?: Record<string, unknown> }

    expect(report.mapped.some((e) => e.path.includes('primaryLigt'))).toBe(true)
    expect(report.notMapped).toEqual([])
    expect(tokens.colors).toHaveProperty('primaryLigt')
  })

  it('positive control: the correctly spelled slot survives the schema', async () => {
    // Without this, the cell above passes on a mapper that carries EVERYTHING
    // through, which would be a different bug. This one also proves the schema
    // keeps a real slot — so the stripping above is about the NAME, not about
    // the pipeline dropping colours generally.
    const res = await imp({ base: dtcg('primaryLight'), dryRun: false })
    expect(res.saved).toBe(true)
    const saved = saveDraft.mock.calls[0]![3] as { colors?: Record<string, unknown> }
    expect(saved.colors).toHaveProperty('primaryLight')
  })
})
