import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The operator's disable / enable command, against a REAL Postgres. Denials
// first: a reference that names nobody, or more than one person, changes
// nothing, and the last enabled owner of an organisation cannot be disabled.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let ua: typeof import('./user-access')
let sessions: typeof import('./sessions')

const ISSUER = 'https://idp.example.com'
const userIds: string[] = []
const orgIds: string[] = []

describe.skipIf(!DATABASE_URL)('operator disable / enable (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    ua = await import('./user-access')
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

  /** A user with an identity at ISSUER, one open session, and optionally an org role. */
  async function person(email?: string) {
    const id = randomUUID()
    const sub = `sub-${id}`
    userIds.push(id)
    await db
      .insert(schema.appUser)
      .values({ id, email: email ?? `ua-${id.slice(0, 8)}@example.com`, emailVerified: true })
    await db.insert(schema.userIdentity).values({ issuer: ISSUER, subject: sub, userId: id })
    await sessions.createSession(db, { sessionMaxMs: 3_600_000 }, { userId: id, idToken: null })
    return { id, sub }
  }
  async function org(...members: Array<{ id: string; role: string }>) {
    const id = randomUUID()
    orgIds.push(id)
    await db.insert(schema.organization).values({ id, name: 'UA', slug: `ua-${id.slice(0, 8)}` })
    for (const m of members) {
      await db.insert(schema.orgMember).values({ organizationId: id, userId: m.id, role: m.role })
    }
    return id
  }
  const state = async (userId: string) => {
    const [u] = await db
      .select({ disabledAt: schema.appUser.disabledAt })
      .from(schema.appUser)
      .where(eq(schema.appUser.id, userId))
    const open = await db
      .select()
      .from(schema.appSession)
      .where(eq(schema.appSession.userId, userId))
    const roles = await db
      .select({ role: schema.orgMember.role })
      .from(schema.orgMember)
      .where(eq(schema.orgMember.userId, userId))
    return { disabled: !!u?.disabledAt, sessions: open.length, roles: roles.map((r) => r.role) }
  }
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: { code?: string; name?: string }) => e.code ?? e.name,
    )

  describe('denials', () => {
    it('a reference that names nobody changes nothing', async () => {
      const p = await person()
      for (const ref of [
        { sub: `sub-${randomUUID()}`, issuer: ISSUER },
        // The same subject at another issuer is another person.
        { sub: p.sub, issuer: 'https://other-idp.example.com' },
        { id: randomUUID() },
        { email: 'nobody-here@example.com' },
      ]) {
        expect(await code(ua.setUserAccess(db, ref, 'disable')), JSON.stringify(ref)).toBe(
          'not_found',
        )
      }
      expect(await state(p.id)).toMatchObject({ disabled: false, sessions: 1 })
    })

    it('refuses empty or malformed references', async () => {
      for (const ref of [
        { sub: '', issuer: ISSUER },
        { sub: 'x', issuer: '' },
        { id: '' },
        { email: 'not-an-address' },
      ]) {
        expect(await code(ua.setUserAccess(db, ref, 'disable')), JSON.stringify(ref)).toBe(
          'invalid_input',
        )
      }
    })

    it('an e-mail address shared by two users is ambiguous: neither is touched', async () => {
      const email = `shared-${randomUUID().slice(0, 8)}@example.com`
      const a = await person(email)
      const b = await person(email.toUpperCase())
      expect(await code(ua.setUserAccess(db, { email }, 'disable'))).toBe('ambiguous')
      expect(await state(a.id)).toMatchObject({ disabled: false, sessions: 1 })
      expect(await state(b.id)).toMatchObject({ disabled: false, sessions: 1 })
    })

    it('the last enabled owner of an organisation cannot be disabled', async () => {
      const owner = await person()
      const orgId = await org({ id: owner.id, role: 'owner' })
      const err = await ua.setUserAccess(db, { id: owner.id }, 'disable').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(sessions.LastOwnerError)
      expect((err as InstanceType<typeof sessions.LastOwnerError>).organizationIds).toEqual([orgId])
      expect(await state(owner.id)).toMatchObject({
        disabled: false,
        sessions: 1,
        roles: ['owner'],
      })
    })
  })

  it('disable by subject: refused from now, sessions gone, roles kept, audited per organisation', async () => {
    const owner = await person()
    const m = await person()
    const orgId = await org({ id: owner.id, role: 'owner' }, { id: m.id, role: 'manager' })

    expect(await ua.setUserAccess(db, { sub: m.sub, issuer: ISSUER }, 'disable')).toEqual({
      userId: m.id,
      changed: true,
    })
    expect(await state(m.id)).toEqual({ disabled: true, sessions: 0, roles: ['manager'] })
    const audit = await db
      .select({ action: schema.auditLog.action, actor: schema.auditLog.actorEmail })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.organizationId, orgId), eq(schema.auditLog.targetId, m.id)))
    expect(audit).toEqual([{ action: 'member.disabled', actor: 'operator' }])

    // Again: nothing changes, nothing more is audited.
    expect(await ua.setUserAccess(db, { id: m.id }, 'disable')).toEqual({
      userId: m.id,
      changed: false,
    })
  })

  it('disabling someone disabled by hand still ends the sessions left open', async () => {
    const p = await person()
    await db
      .update(schema.appUser)
      .set({ disabledAt: new Date() })
      .where(eq(schema.appUser.id, p.id))
    expect(await state(p.id)).toMatchObject({ disabled: true, sessions: 1 })
    expect((await ua.setUserAccess(db, { id: p.id }, 'disable')).changed).toBe(false)
    expect(await state(p.id)).toMatchObject({ disabled: true, sessions: 0 })
  })

  it('enable restores the roles but no old session: the person signs in anew', async () => {
    const owner = await person()
    const p = await person()
    const orgId = await org({ id: owner.id, role: 'owner' }, { id: p.id, role: 'admin' })
    // Disabled by hand, so a session survives the disable.
    await db
      .update(schema.appUser)
      .set({ disabledAt: new Date() })
      .where(eq(schema.appUser.id, p.id))

    expect(await ua.setUserAccess(db, { email: (await email(p.id))! }, 'enable')).toEqual({
      userId: p.id,
      changed: true,
    })
    expect(await state(p.id)).toEqual({ disabled: false, sessions: 0, roles: ['admin'] })
    const audit = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.organizationId, orgId), eq(schema.auditLog.targetId, p.id)))
    expect(audit).toEqual([{ action: 'member.enabled' }])

    expect((await ua.setUserAccess(db, { id: p.id }, 'enable')).changed).toBe(false)
  })

  async function email(userId: string) {
    const [u] = await db
      .select({ email: schema.appUser.email })
      .from(schema.appUser)
      .where(eq(schema.appUser.id, userId))
    return u?.email
  }
})
