import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSession,
  destroySession,
  disableUser,
  enableUser,
  purgeExpiredSessions,
  resolveSession,
} from './sessions'

// Sessions against a REAL Postgres. Denials first: an unknown, expired, idle,
// disabled or foreign token must never resolve to a user.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')

const policy = { sessionIdleMs: 60 * 60 * 1000, sessionMaxMs: 24 * 60 * 60 * 1000 }
const users: string[] = []

describe.skipIf(!DATABASE_URL)('OIDC sessions (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
  })

  afterAll(async () => {
    if (!db) return
    if (users.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, users))
    await db.$client.end()
  })

  async function user(over: Partial<typeof schema.appUser.$inferInsert> = {}) {
    const id = randomUUID()
    users.push(id)
    await db.insert(schema.appUser).values({ id, email: 'a@example.com', name: 'Ada', ...over })
    return id
  }
  const at = (ms: number) => new Date(Date.now() + ms)

  describe('denials', () => {
    it.each([undefined, '', 'nope', 'x'.repeat(300)])('does not resolve token %j', async (t) => {
      expect(await resolveSession(db, policy, t)).toBeNull()
    })

    it('does not resolve a token that was never issued, even one shaped like a real one', async () => {
      const id = await user()
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      const forged = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
      expect(await resolveSession(db, policy, forged)).toBeNull()
    })

    it('ends a session after its absolute lifetime, however active', async () => {
      const id = await user()
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      // Active every 30 minutes, so never idle, until the day is up.
      for (let m = 30; m < 24 * 60; m += 30) {
        expect(await resolveSession(db, policy, token, at(m * 60_000))).not.toBeNull()
      }
      expect(await resolveSession(db, policy, token, at(24 * 3600_000 + 1000))).toBeNull()
    })

    it('ends a session after the idle timeout, and deletes it', async () => {
      const id = await user()
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      expect(await resolveSession(db, policy, token, at(61 * 60_000))).toBeNull()
      expect(await resolveSession(db, policy, token)).toBeNull()
      expect(
        await db.select().from(schema.appSession).where(eq(schema.appSession.userId, id)),
      ).toHaveLength(0)
    })

    it('refuses a disabled user on the very next request', async () => {
      const id = await user()
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      expect(await resolveSession(db, policy, token)).not.toBeNull()
      // Disabled behind the session's back (no row deletion): the re-read catches it.
      await db
        .update(schema.appUser)
        .set({ disabledAt: new Date() })
        .where(eq(schema.appUser.id, id))
      expect(await resolveSession(db, policy, token)).toBeNull()
    })

    it("disableUser deletes every session of that user and no one else's", async () => {
      const a = await user()
      const b = await user()
      const a1 = await createSession(db, policy, { userId: a, idToken: null })
      const a2 = await createSession(db, policy, { userId: a, idToken: null })
      const b1 = await createSession(db, policy, { userId: b, idToken: null })
      expect(await disableUser(db, a)).toBe(true)
      expect(await resolveSession(db, policy, a1.token)).toBeNull()
      expect(await resolveSession(db, policy, a2.token)).toBeNull()
      expect(await resolveSession(db, policy, b1.token)).not.toBeNull()
      expect(
        await db.select().from(schema.appSession).where(eq(schema.appSession.userId, a)),
      ).toHaveLength(0)
    })

    it('a re-enabled user needs a new login: old sessions stay gone', async () => {
      const id = await user()
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      await disableUser(db, id)
      expect(await enableUser(db, id)).toBe(true)
      expect(await resolveSession(db, policy, token)).toBeNull()
      const fresh = await createSession(db, policy, { userId: id, idToken: null })
      expect(await resolveSession(db, policy, fresh.token)).not.toBeNull()
    })

    it('disableUser / enableUser report an unknown user', async () => {
      expect(await disableUser(db, randomUUID())).toBe(false)
      expect(await enableUser(db, randomUUID())).toBe(false)
    })

    it('logout ends only that session', async () => {
      const id = await user()
      const one = await createSession(db, policy, { userId: id, idToken: 'idt' })
      const two = await createSession(db, policy, { userId: id, idToken: null })
      expect(await destroySession(db, one.token)).toBe('idt')
      expect(await resolveSession(db, policy, one.token)).toBeNull()
      expect(await resolveSession(db, policy, two.token)).not.toBeNull()
      expect(await destroySession(db, one.token)).toBeNull()
    })
  })

  describe('sessions', () => {
    it('resolves to the user, with the claim as stored', async () => {
      const id = await user({ emailVerified: true })
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      expect(await resolveSession(db, policy, token)).toEqual({
        userId: id,
        email: 'a@example.com',
        emailVerified: true,
        name: 'Ada',
        activeOrganizationId: null,
      })
    })

    it('stores only a hash of the token', async () => {
      const id = await user()
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      const [row] = await db
        .select()
        .from(schema.appSession)
        .where(eq(schema.appSession.userId, id))
      expect(row!.tokenHash).not.toContain(token)
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(token.length).toBeGreaterThanOrEqual(43)
    })

    it('issues a different token at every login', async () => {
      const id = await user()
      const a = await createSession(db, policy, { userId: id, idToken: null })
      const b = await createSession(db, policy, { userId: id, idToken: null })
      expect(a.token).not.toBe(b.token)
    })

    it('a request slides the idle window', async () => {
      const id = await user()
      const { token } = await createSession(db, policy, { userId: id, idToken: null })
      expect(await resolveSession(db, policy, token, at(50 * 60_000))).not.toBeNull()
      // 50 + 50 minutes is past one idle hour from login, but not from the last request.
      expect(await resolveSession(db, policy, token, at(100 * 60_000))).not.toBeNull()
    })

    it('purges expired sessions when a new one is created', async () => {
      const id = await user()
      const old = await createSession(db, policy, { userId: id, idToken: null })
      await db
        .update(schema.appSession)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.appSession.userId, id))
      await createSession(db, policy, { userId: id, idToken: null })
      expect(await resolveSession(db, policy, old.token)).toBeNull()
      expect(
        await db.select().from(schema.appSession).where(eq(schema.appSession.userId, id)),
      ).toHaveLength(1)
      await purgeExpiredSessions(db)
    })
  })
})
