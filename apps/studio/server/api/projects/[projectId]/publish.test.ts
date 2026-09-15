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
const attestationUpdates: Array<{
  table: string
  servingEndedAt: Date | null
  predicate: unknown
}> = []

// ─── h3 ───────────────────────────────────────────────────────────────────
vi.mock('h3', () => mockH3())

// ─── drizzle-orm ──────────────────────────────────────────────────────────
// Prædikat-byggerne returnerer STRUKTUR, ikke null. Uden det kastede mocken
// where-klausulen væk, og idempotens-testene nedenfor kunne ikke skelne
// "update ramte 0 rækker fordi isNull-guarden ekskluderede dem" fra "update
// nulstillede et løbende ur ved en fejl" — altså præcis den stille regression
// guarden er sat til at forhindre ([review]-fund på #196).
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  desc: () => ({ op: 'desc' }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  max: () => ({ op: 'max' }),
  inArray: (col: unknown, vals: unknown) => ({ op: 'inArray', col, vals }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
  notInArray: (col: unknown, vals: unknown) => ({ op: 'notInArray', col, vals }),
}))

/** Fladt opslag i prædikat-træet — bruges til at bevise at en guard ER der. */
function predicateHasOp(node: unknown, op: string): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as { op?: string; parts?: unknown[] }
  if (n.op === op) return true
  return Array.isArray(n.parts) ? n.parts.some((p) => predicateHasOp(p, op)) : false
}

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
  // Retention-uret skriver via db.update(fontLicenceAttestation) — vi fanger
  // sat/ryddet uden at simulere where-klausulen (den er drizzle's ansvar).
  update: (table: { _?: { name?: string } }) => ({
    set: (values: Record<string, unknown>) => ({
      where: (predicate: unknown) => {
        attestationUpdates.push({
          table: table?._?.name ?? 'unknown',
          servingEndedAt: values.servingEndedAt as Date | null,
          predicate,
        })
        return Promise.resolve()
      },
    }),
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
  fontLicenceAttestation: {
    _: { name: 'font_licence_attestation' },
    projectId: 'projectId',
    file: 'file',
    servingEndedAt: 'servingEndedAt',
  },
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

// ─── curated fonts — rene buffers, pakke-læsning testes i curated-fonts.test.ts ──
vi.mock('~~/server/lib/curated-fonts', () => ({
  curatedFontFiles: (family: string, weights: number[], slot: string) =>
    weights.map((weight) => ({
      name: `fonts/${slot}-${family.toLowerCase()}-${weight}.woff2`,
      weight,
    })),
  readCuratedFont: () => Promise.resolve(Buffer.from('wOF2mock')),
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

// ─── brand quota — the cap itself is tested in server/lib/brand-quota.test.ts ──
const assertBrandCapacity = vi.fn()
vi.mock('~~/server/lib/brand-quota', () => ({
  assertBrandCapacity: (...args: unknown[]) => assertBrandCapacity(...args),
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
  attestationUpdates.length = 0
  draft.length = 0
  published.length = 0
  assertBrandCapacity.mockReset()
  assertBrandCapacity.mockResolvedValue(undefined)
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

  it('refuses a new brand over the hard cap before promoting or writing anything', async () => {
    draft.push({
      id: 'draft-cap',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: { colors: { primary: '#4F46E5' } },
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date('2026-09-15T10:00:00Z'),
    })
    assertBrandCapacity.mockRejectedValue(
      Object.assign(new Error('Active brand limit reached for this plan'), {
        statusCode: 403,
        data: { code: 'brand_quota_exceeded', limit: 3, planKey: 'studio_solo' },
      }),
    )

    await expect(handler(fakeEvent({ params: { projectId: PROJECT.id } }))).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'brand_quota_exceeded' },
    })

    expect(assertBrandCapacity).toHaveBeenCalledWith(ORG.id, PROJECT.id)
    expect(spies.updates).toHaveLength(0)
    expect(spies.storage).toHaveLength(0)
    expect(spies.inserts).toHaveLength(0)
    expect(spies.audit).toHaveLength(0)
    expect(published).toHaveLength(0)
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
          slots: {
            body: {
              source: 'custom',
              family: 'Asp Grotesk',
              weights: [400, 700],
              files: {
                '400': 'fonts/body-asp-grotesk-400.woff2',
                '700': 'fonts/body-asp-grotesk-700.woff2',
              },
              fallbacks: ['humanist'],
            },
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
    expect(keys).toContain(`p/${PROJECT.id}/v1/fonts/body-asp-grotesk-400.woff2`)
    expect(keys).toContain(`p/${PROJECT.id}/v1/fonts/body-asp-grotesk-700.woff2`)
    // Fase C: arkiv → current (det /k serverer)
    expect(keys).toContain(`p/${PROJECT.id}/current/logo.svg`)
    expect(keys).toContain(`p/${PROJECT.id}/current/fonts/body-asp-grotesk-400.woff2`)
    // Kilderne er copies, ikke re-uploads gennem app-processen
    const v1Logo = spies.storage.find((o) => o.key === `p/${PROJECT.id}/v1/logo.svg`)
    expect(v1Logo?.bodyPreview).toBe(`copy:p/${PROJECT.id}/draft/logo.svg`)
    expect(v1Logo?.contentType).toBe('image/svg+xml')
    const currentLogo = spies.storage.find((o) => o.key === `p/${PROJECT.id}/current/logo.svg`)
    expect(currentLogo?.bodyPreview).toBe(`copy:p/${PROJECT.id}/v1/logo.svg`)
    // 4 token-writes + 3 arkiv-copies + 3 current-copies
    expect(spies.storage).toHaveLength(10)
  })

  it('writes selected curated font weights from disk into v{n} and current', async () => {
    draft.push({
      id: 'draft-3',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: {
        typography: {
          slots: {
            heading: {
              source: 'curated',
              family: 'Inter',
              weights: [400, 700],
              fallbacks: ['humanist'],
            },
          },
        },
      },
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date('2026-08-04T11:00:00Z'),
    })

    await handler(fakeEvent({ params: { projectId: PROJECT.id } }))

    const keys = spies.storage.map((o) => o.key)
    expect(keys).toContain(`p/${PROJECT.id}/v1/fonts/heading-inter-400.woff2`)
    expect(keys).toContain(`p/${PROJECT.id}/v1/fonts/heading-inter-700.woff2`)
    expect(keys).toContain(`p/${PROJECT.id}/current/fonts/heading-inter-400.woff2`)
    const v1 = spies.storage.find(
      (o) => o.key === `p/${PROJECT.id}/v1/fonts/heading-inter-400.woff2`,
    )
    expect(v1?.contentType).toBe('font/woff2')
    // arkivet er en PUT fra disk-bufferen (spy'en slicer Buffer → Buffer);
    // current er en copy af arkivet
    expect(String(v1?.bodyPreview)).toBe('wOF2mock')
    const current = spies.storage.find(
      (o) => o.key === `p/${PROJECT.id}/current/fonts/heading-inter-400.woff2`,
    )
    expect(current?.bodyPreview).toBe(`copy:p/${PROJECT.id}/v1/fonts/heading-inter-400.woff2`)
    // 4 token-writes + 2 arkiv-puts + 2 current-copies
    expect(spies.storage).toHaveLength(8)
  })

  // Retention-uret (jura §16a): "slettes 10 år efter at filen SIDST blev
  // serveret". Publish er dér leverancen skifter, så det er dér uret sættes
  // og ryddes. Testene pinner begge retninger + idempotensen.
  it('starts the retention clock for fonts a publish stops serving', async () => {
    draft.push({
      id: 'draft-r1',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: { colors: { primary: '#000' } },
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date('2026-08-04T12:00:00Z'),
    })
    await handler(fakeEvent({ params: { projectId: PROJECT.id } }))
    const set = attestationUpdates.filter((u) => u.servingEndedAt instanceof Date)
    expect(set.length).toBeGreaterThan(0)
    expect(set[0].table).toBe('font_licence_attestation')
    // DEN AFGØRENDE ASSERTION: uret må kun sættes på rækker hvor det ikke
    // allerede løber. Uden isNull-guarden ville hver publish uden font-
    // ændringer skubbe slettedatoen frem — en GDPR-fejl der ser ud som om
    // reglen virker og først bliver synlig om ti år. Fjernes guarden, fejler
    // dette, hvor mock'ens tidligere where-kassering lod det passere.
    expect(predicateHasOp(set[0].predicate, 'isNull')).toBe(true)
  })

  it('clears the clock for fonts that are being served again (rollback)', async () => {
    draft.push({
      id: 'draft-r2',
      projectId: PROJECT.id,
      version: 0,
      status: 'draft',
      tokensJson: {
        typography: {
          slots: {
            body: {
              source: 'custom',
              family: 'Asp Grotesk',
              weights: [400],
              files: { '400': 'fonts/body-asp-grotesk-400.woff2' },
              fallbacks: ['humanist'],
            },
          },
        },
      },
      publishedAt: null,
      publishedBy: null,
      createdAt: new Date('2026-08-04T12:00:00Z'),
    })
    await handler(fakeEvent({ params: { projectId: PROJECT.id } }))
    // Den serverede fil får uret NULSTILLET — scopet til netop de filer der
    // serveres igen (inArray), ikke bredt over projektet.
    const cleared = attestationUpdates.filter((u) => u.servingEndedAt === null)
    expect(cleared).toHaveLength(1)
    expect(predicateHasOp(cleared[0].predicate, 'inArray')).toBe(true)

    // ...og alt ANDET i projektet får det STARTET — med begge guards: kun
    // rækker uden løbende ur (isNull) og kun filer der ikke serveres
    // (notInArray). Mangler én af dem, rammer opdateringen for bredt.
    const started = attestationUpdates.filter((u) => u.servingEndedAt instanceof Date)
    expect(started).toHaveLength(1)
    expect(predicateHasOp(started[0].predicate, 'isNull')).toBe(true)
    expect(predicateHasOp(started[0].predicate, 'notInArray')).toBe(true)
  })
})
