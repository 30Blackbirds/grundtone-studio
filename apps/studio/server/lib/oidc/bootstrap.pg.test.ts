import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// First-owner bootstrap and the disable-user guard, against a REAL Postgres.
// Denials first: no request path can reach bootstrap, a stranger cannot use the
// invitation, and the last enabled owner cannot be disabled.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let b: typeof import('./bootstrap')
let orgs: typeof import('../local-orgs')
let sessions: typeof import('./sessions')

const userIds: string[] = []
const orgIds: string[] = []
const slug = () => `boot-${randomUUID().slice(0, 8)}`

describe.skipIf(!DATABASE_URL)('owner bootstrap (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    b = await import('./bootstrap')
    orgs = await import('../local-orgs')
    sessions = await import('./sessions')
  })
  afterAll(async () => {
    if (!db) return
    if (orgIds.length) {
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, orgIds))
      await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, orgIds))
      await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds))
    }
    if (userIds.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, userIds))
    await db.$client.end()
  })

  async function user(over: Partial<typeof schema.appUser.$inferInsert> = {}) {
    const id = randomUUID()
    const email = `u-${id.slice(0, 8)}@example.com`
    userIds.push(id)
    await db.insert(schema.appUser).values({ id, email, emailVerified: true, ...over })
    return { id, email: over.email ?? email }
  }
  const members = (orgId: string) =>
    db.select().from(schema.orgMember).where(eq(schema.orgMember.organizationId, orgId))

  it('refuses bad input and never creates an organisation without a name', async () => {
    const s = slug()
    await expect(b.bootstrapOwner(db, { email: 'nope', orgSlug: s, orgName: 'X' })).rejects.toThrow(
      b.BootstrapError,
    )
    await expect(
      b.bootstrapOwner(db, { email: 'a@example.com', orgSlug: 'Bad Slug', orgName: 'X' }),
    ).rejects.toThrow(b.BootstrapError)
    await expect(b.bootstrapOwner(db, { email: 'a@example.com', orgSlug: s })).rejects.toThrow(
      /does not exist/,
    )
    expect(
      await db.select().from(schema.organization).where(eq(schema.organization.slug, s)),
    ).toEqual([])
  })

  it('an existing user becomes owner at once', async () => {
    const u = await user()
    const s = slug()
    const r = await b.bootstrapOwner(db, {
      email: u.email.toUpperCase(),
      orgSlug: s,
      orgName: 'Acme',
    })
    expect(r).toMatchObject({ kind: 'member', created: true })
    orgIds.push(r.organizationId)
    expect(await members(r.organizationId)).toMatchObject([{ userId: u.id, role: 'owner' }])
  })

  it('an unknown address gets a one-use owner invitation; a different person cannot use it', async () => {
    const s = slug()
    const invitee = await user()
    const email = `later-${randomUUID().slice(0, 8)}@example.com`
    const r = await b.bootstrapOwner(db, { email, orgSlug: s, orgName: 'Acme' })
    if (r.kind !== 'invitation') throw new Error('expected an invitation')
    orgIds.push(r.organizationId)
    expect(await members(r.organizationId)).toEqual([])
    const stored = await db
      .select()
      .from(schema.orgInvitation)
      .where(eq(schema.orgInvitation.organizationId, r.organizationId))
    expect(JSON.stringify(stored)).not.toContain(r.token)

    await expect(
      orgs.acceptInvitation(db, { ...invitee, emailVerified: true }, r.token, {
        requireEmailVerified: true,
      }),
    ).rejects.toMatchObject({ code: 'invitation_invalid' })
    const owner = await user({ email, emailVerified: false })
    await expect(
      orgs.acceptInvitation(db, { ...owner, emailVerified: false }, r.token, {
        requireEmailVerified: true,
      }),
    ).rejects.toMatchObject({ code: 'email_unverified' })
    await db
      .update(schema.appUser)
      .set({ emailVerified: true })
      .where(eq(schema.appUser.id, owner.id))
    expect(
      await orgs.acceptInvitation(db, { ...owner, emailVerified: true }, r.token, {
        requireEmailVerified: true,
      }),
    ).toEqual({ organizationId: r.organizationId, role: 'owner' })
    await expect(
      orgs.acceptInvitation(db, { ...owner, emailVerified: true }, r.token, {
        requireEmailVerified: true,
      }),
    ).rejects.toMatchObject({ code: 'invitation_invalid' })
  })

  it('running it again replaces the pending invitation instead of piling up', async () => {
    const s = slug()
    const email = `again-${randomUUID().slice(0, 8)}@example.com`
    const a = await b.bootstrapOwner(db, { email, orgSlug: s, orgName: 'Acme' })
    orgIds.push(a.organizationId)
    const c = await b.bootstrapOwner(db, { email, orgSlug: s })
    expect(c).toMatchObject({ kind: 'invitation', created: false })
    const rows = await db
      .select()
      .from(schema.orgInvitation)
      .where(
        and(
          eq(schema.orgInvitation.organizationId, a.organizationId),
          eq(schema.orgInvitation.email, email),
        ),
      )
    expect(rows.filter((r) => !r.revokedAt)).toHaveLength(1)
  })

  it('records the operator action in the audit log', async () => {
    const u = await user()
    const r = await b.bootstrapOwner(db, { email: u.email, orgSlug: slug(), orgName: 'Acme' })
    orgIds.push(r.organizationId)
    const log = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, r.organizationId))
    expect(log.map((l) => l.action)).toContain('member.added')
  })

  describe('disabling a user', () => {
    it('refuses to disable the only enabled owner, and nothing changes', async () => {
      const u = await user()
      const r = await b.bootstrapOwner(db, { email: u.email, orgSlug: slug(), orgName: 'Acme' })
      orgIds.push(r.organizationId)
      await expect(sessions.disableUser(db, u.id)).rejects.toBeInstanceOf(sessions.LastOwnerError)
      const [row] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, u.id))
      expect(row!.disabledAt).toBeNull()
    })

    it('allows it once another enabled owner exists, and a disabled co-owner does not count', async () => {
      const a = await user()
      const c = await user()
      const r = await b.bootstrapOwner(db, { email: a.email, orgSlug: slug(), orgName: 'Acme' })
      orgIds.push(r.organizationId)
      await db
        .insert(schema.orgMember)
        .values({ organizationId: r.organizationId, userId: c.id, role: 'owner' })
      expect(await sessions.disableUser(db, a.id)).toBe(true)
      await expect(sessions.disableUser(db, c.id)).rejects.toBeInstanceOf(sessions.LastOwnerError)
    })

    it('an owner who is only a member elsewhere, or already disabled, is not blocked', async () => {
      const a = await user()
      const r = await b.bootstrapOwner(db, { email: a.email, orgSlug: slug(), orgName: 'Acme' })
      orgIds.push(r.organizationId)
      await db
        .update(schema.appUser)
        .set({ disabledAt: new Date() })
        .where(eq(schema.appUser.id, a.id))
      expect(await sessions.disableUser(db, a.id)).toBe(true)
      const plain = await user()
      await db
        .insert(schema.orgMember)
        .values({ organizationId: r.organizationId, userId: plain.id, role: 'admin' })
      expect(await sessions.disableUser(db, plain.id)).toBe(true)
    })
  })
})
