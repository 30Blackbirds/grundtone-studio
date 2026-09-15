import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'
import { DEFAULT_TOKENS } from '~~/server/lib/tokens'

// Concurrency cells for the active-brand cap (riff cjbjm73hjpwgh2c3eja8jry9).
//
// These run the REAL publish and activate handlers against a REAL Postgres,
// because the property under test is what the database does with two
// interleaved requests; a mocked db can replay an interleaving but cannot show
// that a lock or constraint actually serialises anything. Only the edges that
// leave the process are mocked: auth, entitlements, object storage, CDN purge
// and the audit writer.
//
// CI provides Postgres (ci.yml Test job). turbo runs in strict env mode, so
// DATABASE_URL reaches this process only because turbo.json lists it for the
// test task; without that line every cell here would skip and the job would
// stay green without measuring anything. The throw below turns that silent
// skip into a red run in CI.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error(
    'DATABASE_URL is not visible to the test process in CI: turbo strict env mode filters it unless turbo.json passes it to the test task',
  )
}

const SOLO_BRAND_LIMIT = 3
const ACTOR = 'race-user'

vi.mock('h3', () => mockH3())

// Storage: every write is recorded per project, and one project at a time can
// be held at its first write. Holding a request at storage is what opens the
// window between the cap check and the active_version write.
interface Gate {
  projectId: string
  reached: () => void
  release: Promise<void>
}
const storageWrites: Array<{ projectId: string; key: string }> = []
let gate: Gate | null = null

vi.mock('~~/server/lib/storage', () => {
  const write = async (key: string) => {
    const projectId = key.split('/')[1] ?? ''
    if (gate && gate.projectId === projectId) {
      const held = gate
      gate = null
      held.reached()
      await held.release
    }
    storageWrites.push({ projectId, key })
  }
  return {
    paths: (projectId: string) => ({
      versionedJson: (n: number) => `p/${projectId}/v${n}/tokens.json`,
      versionedCss: (n: number) => `p/${projectId}/v${n}/tokens.css`,
      currentJson: `p/${projectId}/current.json`,
      currentCss: `p/${projectId}/current.css`,
      draftAsset: (name: string) => `p/${projectId}/draft/${name}`,
      versionedAsset: (n: number, name: string) => `p/${projectId}/v${n}/${name}`,
      currentAsset: (name: string) => `p/${projectId}/current/${name}`,
    }),
    putObject: (key: string) => write(key),
    copyObject: (_source: string, dest: string) => write(dest),
    getObjectAsString: () => Promise.resolve(null),
  }
})
vi.mock('~~/server/lib/bunny', () => ({ purgeProjectCdn: () => Promise.resolve(0) }))
vi.mock('~~/server/lib/audit', () => ({ recordAuditEvent: () => Promise.resolve() }))
vi.mock('~~/server/lib/curated-fonts', () => ({
  curatedFontFiles: () => [],
  readCuratedFont: () => Promise.resolve(Buffer.alloc(0)),
}))
vi.mock('~~/server/lib/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./entitlements')>()
  return {
    ...actual,
    getStudioEntitlements: () =>
      Promise.resolve({
        planKey: 'studio_solo',
        planState: 'active',
        graceUntil: null,
        limits: { 'studio.brands': 3 },
      }),
  }
})

const projectsById = new Map<string, { id: string; organizationId: string; name: string }>()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (_event: unknown, projectId: string) => {
    const found = projectsById.get(projectId)
    if (!found) return Promise.reject(new Error(`unknown project ${projectId}`))
    return Promise.resolve({
      userId: ACTOR,
      project: found,
      organization: { id: found.organizationId },
      role: 'admin',
    })
  },
}))

type Handler = (event: unknown) => Promise<unknown>
type Outcome = { ok: true } | { ok: false; error: { statusCode?: number; data?: unknown } }

let db: typeof import('~~/server/db').db
let schema: typeof import('~~/server/db/schema')
let publish: Handler
let activate: Handler
let claimBrandSlot: typeof import('./brand-quota').claimBrandSlot
const createdOrgs: string[] = []

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const settle = (run: Promise<unknown>): Promise<Outcome> =>
  run.then(
    (): Outcome => ({ ok: true }),
    (error: { statusCode?: number; data?: unknown }): Outcome => ({ ok: false, error }),
  )

const label = (o: Outcome) => (o.ok ? 'ok' : `http-${o.error.statusCode ?? 'error'}`)

async function newProject(organizationId: string, status: 'draft' | 'published') {
  const [row] = await db
    .insert(schema.project)
    .values({ organizationId, slug: `p-${randomUUID()}`, name: 'Race brand' })
    .returning({ id: schema.project.id })
  projectsById.set(row.id, { id: row.id, organizationId, name: 'Race brand' })
  const [version] = await db
    .insert(schema.configVersion)
    .values({
      projectId: row.id,
      version: status === 'draft' ? 0 : 1,
      status,
      tokensJson: DEFAULT_TOKENS as unknown as Record<string, unknown>,
      publishedAt: status === 'published' ? new Date() : null,
      publishedBy: status === 'published' ? ACTOR : null,
    })
    .returning({ id: schema.configVersion.id })
  return { projectId: row.id, versionId: version.id }
}

/** An org on Solo with `activeBrands` projects that already have an active version. */
async function seedOrg(activeBrands: number): Promise<string> {
  const organizationId = `race-org-${randomUUID()}`
  createdOrgs.push(organizationId)
  for (let i = 0; i < activeBrands; i += 1) {
    const { projectId, versionId } = await newProject(organizationId, 'published')
    await db
      .insert(schema.activeVersion)
      .values({ projectId, configVersionId: versionId, activatedBy: ACTOR })
  }
  return organizationId
}

function activeBrandCount(organizationId: string): Promise<number> {
  return db.$count(
    schema.activeVersion,
    inArray(
      schema.activeVersion.projectId,
      db
        .select({ id: schema.project.id })
        .from(schema.project)
        .where(eq(schema.project.organizationId, organizationId)),
    ),
  )
}

/**
 * Resolves once any session in this database is waiting on a lock. A cure that
 * serialises by blocking would otherwise deadlock against the storage gate:
 * the held request waits for the second one to finish while the second waits
 * for the held request's lock.
 */
function lockWaiterSeen(stop: { stopped: boolean }): Promise<void> {
  return (async () => {
    while (!stop.stopped) {
      const rows = (await db.execute(
        sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )) as unknown as Array<{ n: number }>
      if (Number(rows[0]?.n) > 0) return
      await sleep(25)
    }
  })()
}

/**
 * Runs `first` until it reaches its first storage write, then runs `second` to
 * completion (or until it blocks on a lock), then lets `first` finish. On code
 * where the cap check and the active_version write are separate statements this
 * is exactly the interleaving that lets both requests pass the check.
 */
async function race(
  first: { projectId: string; run: () => Promise<unknown> },
  second: { run: () => Promise<unknown> },
): Promise<[Outcome, Outcome]> {
  let reached!: () => void
  let release!: () => void
  const reachedStorage = new Promise<void>((resolve) => (reached = resolve))
  gate = {
    projectId: first.projectId,
    reached,
    release: new Promise<void>((resolve) => (release = resolve)),
  }

  const firstOutcome = settle(first.run())
  await Promise.race([reachedStorage, firstOutcome, sleep(2_000)])

  const stop = { stopped: false }
  const secondOutcome = settle(second.run())
  await Promise.race([secondOutcome, lockWaiterSeen(stop), sleep(5_000)])
  stop.stopped = true

  release()
  gate = null
  return [await firstOutcome, await secondOutcome]
}

const publishEvent = (projectId: string) => fakeEvent({ params: { projectId } })
const activateEvent = (projectId: string, versionId: string) =>
  fakeEvent({ params: { projectId }, body: { versionId } })

describe.skipIf(!DATABASE_URL)('active-brand cap under concurrency (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    publish = (await import('~~/server/api/projects/[projectId]/publish.post'))
      .default as unknown as Handler
    activate = (await import('~~/server/api/projects/[projectId]/activate.post'))
      .default as unknown as Handler
    ;({ claimBrandSlot } = await import('./brand-quota'))
  })

  afterAll(async () => {
    if (!db) return
    const orgProjects = db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(inArray(schema.project.organizationId, createdOrgs))
    // active_version → config_version is ON DELETE RESTRICT, so the pointer rows
    // go first; deleting the projects then cascades their versions.
    await db
      .delete(schema.activeVersion)
      .where(inArray(schema.activeVersion.projectId, orgProjects))
    await db.delete(schema.project).where(inArray(schema.project.organizationId, createdOrgs))
    await db.$client.end()
  })

  beforeEach(() => {
    storageWrites.length = 0
    gate = null
  })

  it(
    'control: sequential first publishes stop at the Solo limit',
    { timeout: 20_000 },
    async () => {
      const organizationId = await seedOrg(SOLO_BRAND_LIMIT - 1)
      const a = await newProject(organizationId, 'draft')
      const b = await newProject(organizationId, 'draft')

      const outcomes = [
        await settle(publish(publishEvent(a.projectId))),
        await settle(publish(publishEvent(b.projectId))),
      ]

      expect({
        brands: await activeBrandCount(organizationId),
        outcomes: outcomes.map(label),
      }).toEqual({ brands: SOLO_BRAND_LIMIT, outcomes: ['ok', 'http-403'] })
    },
  )

  it(
    'two concurrent first publishes at limit-1: exactly one becomes a brand, the other changes nothing',
    { timeout: 20_000 },
    async () => {
      const organizationId = await seedOrg(SOLO_BRAND_LIMIT - 1)
      const a = await newProject(organizationId, 'draft')
      const b = await newProject(organizationId, 'draft')

      const outcomes = await race(
        { projectId: a.projectId, run: () => publish(publishEvent(a.projectId)) },
        { run: () => publish(publishEvent(b.projectId)) },
      )

      expect({
        brands: await activeBrandCount(organizationId),
        outcomes: outcomes.map(label).sort(),
      }).toEqual({ brands: SOLO_BRAND_LIMIT, outcomes: ['http-403', 'ok'] })

      const refused = outcomes[0].ok ? b : a
      const refusal = outcomes.find((o) => !o.ok)
      expect(refusal).toMatchObject({
        error: { statusCode: 403, data: { code: 'brand_quota_exceeded', limit: SOLO_BRAND_LIMIT } },
      })
      // Nothing for /k to serve, and no version number reserved.
      expect(storageWrites.filter((w) => w.projectId === refused.projectId)).toEqual([])
      const [draft] = await db
        .select({ status: schema.configVersion.status })
        .from(schema.configVersion)
        .where(
          and(
            eq(schema.configVersion.projectId, refused.projectId),
            eq(schema.configVersion.id, refused.versionId),
          ),
        )
      expect(draft?.status).toBe('draft')
    },
  )

  it(
    'two concurrent first activations at limit-1: exactly one becomes a brand, the other changes nothing',
    { timeout: 20_000 },
    async () => {
      const organizationId = await seedOrg(SOLO_BRAND_LIMIT - 1)
      const a = await newProject(organizationId, 'published')
      const b = await newProject(organizationId, 'published')

      const outcomes = await race(
        { projectId: a.projectId, run: () => activate(activateEvent(a.projectId, a.versionId)) },
        { run: () => activate(activateEvent(b.projectId, b.versionId)) },
      )

      expect({
        brands: await activeBrandCount(organizationId),
        outcomes: outcomes.map(label).sort(),
      }).toEqual({ brands: SOLO_BRAND_LIMIT, outcomes: ['http-403', 'ok'] })

      const refused = outcomes[0].ok ? b : a
      expect(storageWrites.filter((w) => w.projectId === refused.projectId)).toEqual([])
    },
  )

  // The handler cells above are refused by the unlocked pre-check, because the
  // held request's claim has already committed. These two hold a claim's
  // transaction OPEN after its insert, which is the only interleaving where the
  // lock and the re-check under it decide the outcome.
  const soloClaim = (organizationId: string): import('./brand-quota').BrandClaim => ({
    organizationId,
    entitlements: {
      planKey: 'studio_solo',
      planState: 'active',
      graceUntil: null,
      features: [],
      limits: { 'studio.brands': SOLO_BRAND_LIMIT },
      asOf: '2026-09-15T00:00:00.000Z',
    },
    hardCap: true,
  })
  const rowFor = (p: { projectId: string; versionId: string }) => ({
    projectId: p.projectId,
    configVersionId: p.versionId,
    activatedBy: ACTOR,
  })

  /** Claims `first` and holds its transaction open while `second` claims. */
  async function overlappingClaims(
    organizationId: string,
    first: { projectId: string; versionId: string },
    second: { projectId: string; versionId: string },
  ): Promise<[Outcome, Outcome]> {
    const claim = soloClaim(organizationId)
    let claimed!: () => void
    let release!: () => void
    const firstClaimed = new Promise<void>((resolve) => (claimed = resolve))
    const held = new Promise<void>((resolve) => (release = resolve))

    const firstOutcome = settle(
      db.transaction(async (tx) => {
        await claimBrandSlot(tx, claim, rowFor(first))
        claimed()
        await held
      }),
    )
    await Promise.race([firstClaimed, firstOutcome])

    const stop = { stopped: false }
    const secondOutcome = settle(db.transaction((tx) => claimBrandSlot(tx, claim, rowFor(second))))
    await Promise.race([secondOutcome, lockWaiterSeen(stop), sleep(5_000)])
    stop.stopped = true

    release()
    return [await firstOutcome, await secondOutcome]
  }

  it(
    'overlapping claims for two projects at limit-1 serialise on the organization lock',
    { timeout: 20_000 },
    async () => {
      const organizationId = await seedOrg(SOLO_BRAND_LIMIT - 1)
      const a = await newProject(organizationId, 'published')
      const b = await newProject(organizationId, 'published')

      const outcomes = await overlappingClaims(organizationId, a, b)

      expect({
        brands: await activeBrandCount(organizationId),
        outcomes: outcomes.map(label),
      }).toEqual({ brands: SOLO_BRAND_LIMIT, outcomes: ['ok', 'http-403'] })
    },
  )

  it(
    'overlapping claims for the same project at limit-1 create one brand and refuse neither',
    { timeout: 20_000 },
    async () => {
      const organizationId = await seedOrg(SOLO_BRAND_LIMIT - 1)
      const a = await newProject(organizationId, 'published')

      const outcomes = await overlappingClaims(organizationId, a, a)

      expect({
        brands: await activeBrandCount(organizationId),
        outcomes: outcomes.map(label),
      }).toEqual({ brands: SOLO_BRAND_LIMIT, outcomes: ['ok', 'ok'] })
    },
  )
})
