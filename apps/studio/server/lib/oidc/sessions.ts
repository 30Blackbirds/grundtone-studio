import { createHash, randomBytes } from 'node:crypto'
import { eq, lte } from 'drizzle-orm'
import type { Db } from '../../db'
import { appSession, appUser } from '../../db/schema'
import type { OidcConfig } from './config'

// Studio-owned browser sessions (AUTH_MODE=oidc). See
// docs/design/standalone-oidc.md, "Sessions and cookies".
//
// 🔴 THE USER IS RE-READ ON EVERY LOOKUP. A session row says "this token was
// issued to user X", never "user X may act now": a disabled user fails the very
// next request, and disabling also deletes the rows so nothing lingers.

/** Writes to lastSeenAt at most this often, so a busy page is not a write storm. */
const TOUCH_AFTER_MS = 60 * 1000

export interface SessionUser {
  userId: string
  email: string | null
  emailVerified: boolean
  name: string | null
  activeOrganizationId: string | null
}

const hash = (token: string): string => createHash('sha256').update(token).digest('hex')

/** A new session. The token is returned once and never stored. */
export async function createSession(
  db: Db,
  cfg: Pick<OidcConfig, 'sessionMaxMs'>,
  input: { userId: string; idToken: string | null },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  // Housekeeping with the write, as for login attempts: nothing accumulates.
  await purgeExpiredSessions(db, now)
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + cfg.sessionMaxMs)
  await db.insert(appSession).values({
    tokenHash: hash(token),
    userId: input.userId,
    idToken: input.idToken,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  })
  return { token, expiresAt }
}

/** The signed-in user behind a cookie value, or null. Never throws for a bad token. */
export async function resolveSession(
  db: Db,
  cfg: Pick<OidcConfig, 'sessionIdleMs'>,
  token: string | undefined,
  now = new Date(),
): Promise<SessionUser | null> {
  if (!token || token.length > 256) return null
  const tokenHash = hash(token)
  const [row] = await db
    .select({
      userId: appSession.userId,
      activeOrganizationId: appSession.activeOrganizationId,
      lastSeenAt: appSession.lastSeenAt,
      expiresAt: appSession.expiresAt,
      email: appUser.email,
      emailVerified: appUser.emailVerified,
      name: appUser.name,
      disabledAt: appUser.disabledAt,
    })
    .from(appSession)
    .innerJoin(appUser, eq(appUser.id, appSession.userId))
    .where(eq(appSession.tokenHash, tokenHash))
  if (!row) return null

  const expired =
    row.expiresAt.getTime() <= now.getTime() ||
    now.getTime() - row.lastSeenAt.getTime() >= cfg.sessionIdleMs
  if (expired || row.disabledAt) {
    await db.delete(appSession).where(eq(appSession.tokenHash, tokenHash))
    return null
  }
  if (now.getTime() - row.lastSeenAt.getTime() >= TOUCH_AFTER_MS) {
    await db.update(appSession).set({ lastSeenAt: now }).where(eq(appSession.tokenHash, tokenHash))
  }
  return {
    userId: row.userId,
    email: row.email,
    emailVerified: row.emailVerified,
    name: row.name,
    activeOrganizationId: row.activeOrganizationId,
  }
}

/** Ends one session; returns its id_token (the logout hint) when it existed. */
export async function destroySession(db: Db, token: string | undefined): Promise<string | null> {
  if (!token || token.length > 256) return null
  const [row] = await db
    .delete(appSession)
    .where(eq(appSession.tokenHash, hash(token)))
    .returning({ idToken: appSession.idToken })
  return row?.idToken ?? null
}

export async function purgeExpiredSessions(db: Db, now = new Date()): Promise<void> {
  await db.delete(appSession).where(lte(appSession.expiresAt, now))
}

/**
 * Disable a user: they are refused at login and at every request, and their
 * sessions are deleted now. Role rows are kept so re-enabling restores access.
 * Returns false for an unknown user.
 */
export async function disableUser(db: Db, userId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(appUser)
      .set({ disabledAt: now })
      .where(eq(appUser.id, userId))
      .returning({ id: appUser.id })
    if (updated.length === 0) return false
    await tx.delete(appSession).where(eq(appSession.userId, userId))
    return true
  })
}

export async function enableUser(db: Db, userId: string): Promise<boolean> {
  const updated = await db
    .update(appUser)
    .set({ disabledAt: null })
    .where(eq(appUser.id, userId))
    .returning({ id: appUser.id })
  return updated.length > 0
}
