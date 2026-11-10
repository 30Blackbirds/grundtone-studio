import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// The one-time backfill read from an export file (D-E6 = B), against a REAL
// Postgres. Every fixture is synthetic. GREEN first; each other cell changes
// one thing in it. Same guard as the other *.pg suites.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let sync: typeof import('./org-member-sync')
let fileSource: typeof import('./org-member-file-source')

const a = `omf-${randomUUID()}`
const b = `omf-${randomUUID()}`
const ORGS = [a, b]
let dir: string

type Json = {
  format: string
  exportedAt: string
  orgCount: number
  memberTotal: number
  orgs: Array<{
    orgId: string
    memberCount: number
    members: Array<{ userId: string; role: string }>
  }>
  complete: boolean
}

function green(): Json {
  return {
    format: 'klanghaus.org-members/1',
    exportedAt: '2026-11-10T21:05:57.123456Z',
    orgCount: 2,
    memberTotal: 3,
    orgs: [
      {
        orgId: a,
        memberCount: 2,
        members: [
          { userId: 'u-owner', role: 'owner' },
          { userId: 'u-admin', role: 'admin' },
        ],
      },
      { orgId: b, memberCount: 1, members: [{ userId: 'u-billing', role: 'billing' }] },
    ],
    complete: true,
  }
}

/** Writes `bytes` to a fresh file and returns a source with their digest. */
async function sourceFor(bytes: Buffer) {
  const path = join(dir, `${randomUUID()}.json`)
  await writeFile(path, bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { path, sha256, source: fileSource.fileMemberSource({ path, sha256 }) }
}
const bytesOf = (j: Json) => Buffer.from(JSON.stringify(j) + '\n')

async function rows(orgId: string) {
  return (
    await db
      .select({ userId: schema.orgMember.userId, role: schema.orgMember.role })
      .from(schema.orgMember)
      .where(eq(schema.orgMember.organizationId, orgId))
  ).sort((x, y) => x.userId.localeCompare(y.userId))
}

async function nothingWritten() {
  expect(await rows(a)).toEqual([])
  expect(await rows(b)).toEqual([])
  const audit = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(inArray(schema.auditLog.organizationId, ORGS))
  expect(audit).toEqual([])
}

describe.skipIf(!DATABASE_URL)('backfill from an export file (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    sync = await import('./org-member-sync')
    fileSource = await import('./org-member-file-source')
    dir = await mkdtemp(join(tmpdir(), 'omf-'))
  })

  beforeEach(async () => {
    await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, ORGS))
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, ORGS))
  })

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    if (!db) return
    await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, ORGS))
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, ORGS))
    await db.$client.end()
  })

  it('GREEN: a complete file with matching counts inserts every member, with audit rows', async () => {
    const { source } = await sourceFor(bytesOf(green()))
    const c = await sync.backfillOrgMembers(db, source, { dryRun: false })
    expect(c).toMatchObject({
      complete: true,
      orgs: 2,
      membersRead: 3,
      inserted: 3,
      removedAfterReread: 0,
      unproven: [],
      busyOrgs: [],
    })
    expect(await rows(a)).toEqual([
      { userId: 'u-admin', role: 'admin' },
      { userId: 'u-owner', role: 'owner' },
    ])
    expect(await rows(b)).toEqual([{ userId: 'u-billing', role: 'billing' }])
    const audit = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.organizationId, ORGS))
    expect(audit.map((r) => r.action)).toEqual([
      'member.backfilled',
      'member.backfilled',
      'member.backfilled',
    ])
  })

  it('a truncated file: refused, nothing written', async () => {
    const { source } = await sourceFor(bytesOf(green()).subarray(0, 150))
    await expect(sync.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
      fileSource.OrgMemberFileRefused,
    )
    await nothingWritten()
  })

  it('a file truncated after its digest was taken: refused, nothing written', async () => {
    const { path, source } = await sourceFor(bytesOf(green()))
    await writeFile(path, bytesOf(green()).subarray(0, 150))
    await expect(sync.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
      'does not match the expected sha256',
    )
    await nothingWritten()
  })

  it('an orgCount that does not match: refused, nothing written', async () => {
    const j = green()
    j.orgCount = 3
    const { source } = await sourceFor(bytesOf(j))
    await expect(sync.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
      'orgCount is 3',
    )
    await nothingWritten()
  })

  it('a memberCount that does not match: refused, nothing written (also for the other org)', async () => {
    const j = green()
    j.orgs[1]!.memberCount = 2
    const { source } = await sourceFor(bytesOf(j))
    await expect(sync.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
      'orgs.1: memberCount is 2',
    )
    await nothingWritten()
  })

  it('a memberTotal that does not match the lists: refused, nothing written', async () => {
    const j = green()
    j.memberTotal = 4
    const { source } = await sourceFor(bytesOf(j))
    await expect(sync.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
      'memberTotal is 4',
    )
    await nothingWritten()
  })

  it('an org with 0 members: loads, inserts nothing there, leaves its studio rows alone', async () => {
    const j = green()
    j.orgs[1] = { orgId: b, memberCount: 0, members: [] }
    j.memberTotal = 2
    await db
      .insert(schema.orgMember)
      .values({ organizationId: b, userId: 'u-route', role: 'member' })
    const { source } = await sourceFor(bytesOf(j))
    const c = await sync.backfillOrgMembers(db, source, { dryRun: false })
    expect(c).toMatchObject({ inserted: 2, unproven: [] })
    expect(await rows(b)).toEqual([{ userId: 'u-route', role: 'member' }])
    expect((await rows(a)).length).toBe(2)
  })

  it('a comma-separated role: the highest known role is inserted and counted', async () => {
    const j = green()
    j.orgs[1]!.members[0]!.role = 'billing,member'
    const { source } = await sourceFor(bytesOf(j))
    const c = await sync.backfillOrgMembers(db, source, { dryRun: false })
    expect(c).toMatchObject({ inserted: 3, multipleRoles: 1 })
    expect(await rows(b)).toEqual([{ userId: 'u-billing', role: 'member' }])
  })

  it('an empty userId: refused, nothing written', async () => {
    const j = green()
    j.orgs[1]!.members[0]!.userId = ''
    const { source } = await sourceFor(bytesOf(j))
    await expect(sync.backfillOrgMembers(db, source, { dryRun: false })).rejects.toThrow(
      fileSource.OrgMemberFileRefused,
    )
    await nothingWritten()
  })

  // Studio has no user table: it cannot tell whether a well-formed userId
  // exists in auth. That rests on auth's export (member.userId references
  // user.id there). This cell pins the behaviour so it is not a surprise.
  it('a well-formed userId studio has never seen: inserted (studio cannot check it)', async () => {
    const j = green()
    j.orgs[1]!.members[0]!.userId = `never-seen-${randomUUID()}`
    const { source } = await sourceFor(bytesOf(j))
    const c = await sync.backfillOrgMembers(db, source, { dryRun: false })
    expect(c.inserted).toBe(3)
    expect((await rows(b)).length).toBe(1)
  })

  it('the file replaced between the listing and the second read: that org’s rows go again, the run stops', async () => {
    const { path, source } = await sourceFor(bytesOf(green()))
    let reads = 0
    const swapping = {
      listOrgs: () => source.listOrgs(),
      readOrg: async (orgId: string) => {
        if (reads++ === 0)
          await writeFile(path, bytesOf({ ...green(), exportedAt: '2026-11-11T00:00:00.000Z' }))
        return source.readOrg(orgId)
      },
    }
    await expect(sync.backfillOrgMembers(db, swapping, { dryRun: false })).rejects.toThrow(
      'does not match the expected sha256',
    )
    expect(await rows(a)).toEqual([])
    expect(await rows(b)).toEqual([])
  })
})
