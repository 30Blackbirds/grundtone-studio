import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The local authorizer against a REAL Postgres: the joins, the constraints and
// the cascades only exist there. Same guard as the other *.pg suites;
// `test:coverage` excludes it by name.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let authz: typeof import('./local-authorizer').localAuthorizer

const org = `la-${randomUUID()}`
const otherOrg = `la-${randomUUID()}`
let p1: string
let p2: string
let foreign: string
let keyId: string

const event = (sub: string) => ({ context: { auth: { sub, tenant: org } } }) as never

describe.skipIf(!DATABASE_URL)('localAuthorizer (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    ;({ localAuthorizer: authz } = await import('./local-authorizer'))
    const mk = async (o: string) =>
      (
        await db
          .insert(schema.project)
          .values({ organizationId: o, slug: `p-${randomUUID()}`, name: 'la' })
          .returning({ id: schema.project.id })
      )[0]!.id
    p1 = await mk(org)
    p2 = await mk(org)
    foreign = await mk(otherOrg)
    await db.insert(schema.orgMember).values([
      { organizationId: org, userId: 'owner-u', role: 'owner' },
      { organizationId: org, userId: 'member-u', role: 'member' },
      { organizationId: org, userId: 'billing-u', role: 'billing' },
    ])
    const [key] = await db
      .insert(schema.apiKey)
      .values({
        projectId: p1,
        keyHash: `h-${randomUUID()}`,
        keyPrefix: 'sk_',
        createdBy: 'owner-u',
      })
      .returning({ id: schema.apiKey.id })
    keyId = key!.id
  })

  afterAll(async () => {
    if (!db) return
    await db
      .delete(schema.orgMember)
      .where(inArray(schema.orgMember.organizationId, [org, otherOrg]))
    await db.delete(schema.project).where(inArray(schema.project.organizationId, [org, otherOrg]))
    await db.$client.end()
  })

  it('org owner administers every project in the org, and none outside it', async () => {
    expect(await authz.checkProject(event('owner-u'), p1, 'can_admin')).toBe('allowed')
    expect(await authz.checkProject(event('owner-u'), p2, 'can_admin')).toBe('allowed')
    expect(await authz.checkProject(event('owner-u'), foreign, 'can_view')).toBe('denied')
  })

  it('org member views and does not edit', async () => {
    expect(await authz.checkProject(event('member-u'), p1, 'can_view')).toBe('allowed')
    expect(await authz.checkProject(event('member-u'), p1, 'can_edit')).toBe('denied')
  })

  it('🔴 org billing sees no project', async () => {
    expect(await authz.checkProject(event('billing-u'), p1, 'can_view')).toBe('denied')
  })

  it('checkOrg reads the exact role', async () => {
    expect(await authz.checkOrg(event('owner-u'), org, 'owner')).toBe('allowed')
    expect(await authz.checkOrg(event('owner-u'), org, 'member')).toBe('denied')
    expect(await authz.checkOrg(event('owner-u'), otherOrg, 'owner')).toBe('denied')
  })

  it('a direct project grant lifts a member to editor on that project only, and revoke drops it', async () => {
    await authz.grantProjectRole(event('owner-u'), p1, 'member-u', 'editor')
    expect(await authz.checkProject(event('member-u'), p1, 'can_edit')).toBe('allowed')
    expect(await authz.checkProject(event('member-u'), p2, 'can_edit')).toBe('denied')
    await authz.revokeProjectRole(event('owner-u'), p1, 'member-u', 'editor')
    expect(await authz.checkProject(event('member-u'), p1, 'can_edit')).toBe('denied')
  })

  it('grant upserts, so the invite-accept write after it does not collide', async () => {
    await authz.grantProjectRole(event('owner-u'), p2, 'guest', 'viewer')
    await authz.grantProjectRole(event('owner-u'), p2, 'guest', 'admin')
    const rows = await db
      .select({ role: schema.projectMember.role })
      .from(schema.projectMember)
      .where(eq(schema.projectMember.userId, 'guest'))
    expect(rows).toEqual([{ role: 'admin' }])
  })

  it('batchCheckProjects answers per project in one call', async () => {
    expect(await authz.batchCheckProjects(event('member-u'), [p1, foreign], 'can_view')).toEqual({
      [p1]: 'allowed',
      [foreign]: 'denied',
    })
  })

  it('a machine key is editor on its granted project only, never admin', async () => {
    const m = event(`machine:${keyId}`)
    expect(await authz.checkProject(m, p1, 'can_edit')).toBe('denied')
    await authz.grantMachineProjectRole(m, p1, keyId, 'editor')
    expect(await authz.checkProject(m, p1, 'can_edit')).toBe('allowed')
    expect(await authz.checkProject(m, p1, 'can_admin')).toBe('denied')
    expect(await authz.checkProject(m, p2, 'can_view')).toBe('denied')
    await authz.revokeMachineProjectRole(m, p1, keyId, 'editor')
    expect(await authz.checkProject(m, p1, 'can_edit')).toBe('denied')
  })

  // 🔴 The constraints are the second line: even a caller that asks for more
  // than the model allows gets nothing written.
  it('the table refuses a machine admin grant and an unknown org role', async () => {
    await expect(authz.grantMachineProjectRole(event('x'), p1, keyId, 'admin')).rejects.toThrow()
    await expect(
      db.insert(schema.orgMember).values({ organizationId: org, userId: 'z', role: 'root' }),
    ).rejects.toThrow()
  })

  it('deleting the key deletes its grants', async () => {
    await authz.grantMachineProjectRole(event('x'), p1, keyId, 'editor')
    await db.delete(schema.apiKey).where(eq(schema.apiKey.id, keyId))
    const left = await db
      .select()
      .from(schema.projectMachineGrant)
      .where(eq(schema.projectMachineGrant.apiKeyId, keyId))
    expect(left).toEqual([])
  })
})
