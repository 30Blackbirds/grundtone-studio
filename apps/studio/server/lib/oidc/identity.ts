import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../../db'
import { appUser, userIdentity } from '../../db/schema'
import type { OidcConfig } from './config'
import { OidcLoginError, type VerifiedClaims } from './flow'

// Maps a verified (issuer, subject) to a Studio user, creating the user at
// first login (JIT) unless the operator turned that off.
//
// 🔴 TWO RULES THAT ARE SECURITY, NOT STYLE
//   1. The key is (issuer, subject) only. Two identities with the same e-mail
//      stay two users: linking by e-mail is an account-takeover primitive when
//      an IdP does not verify addresses.
//   2. A new user has no organisation membership, so every access check denies
//      them. Creating the user grants nothing.

function emailDomainAllowed(cfg: OidcConfig, claims: VerifiedClaims): boolean {
  if (cfg.allowedEmailDomains.length === 0) return true
  // An allowlist is only meaningful for an address the IdP vouches for.
  if (!claims.email || !claims.emailVerified) return false
  const domain = claims.email.split('@').pop()?.toLowerCase()
  return domain !== undefined && cfg.allowedEmailDomains.includes(domain)
}

export interface ResolvedUser {
  id: string
  created: boolean
}

export async function resolveUser(
  db: Db,
  cfg: OidcConfig,
  claims: VerifiedClaims,
  now = new Date(),
): Promise<ResolvedUser> {
  if (!emailDomainAllowed(cfg, claims)) throw new OidcLoginError('domain_not_allowed')

  return db.transaction(async (tx) => {
    const find = async () => {
      const [row] = await tx
        .select({ id: appUser.id, disabledAt: appUser.disabledAt })
        .from(userIdentity)
        .innerJoin(appUser, eq(appUser.id, userIdentity.userId))
        .where(
          and(eq(userIdentity.issuer, claims.issuer), eq(userIdentity.subject, claims.subject)),
        )
      return row
    }

    let existing = await find()
    let created = false
    if (!existing) {
      if (!cfg.jit) throw new OidcLoginError('jit_off')
      const id = randomUUID()
      await tx.insert(appUser).values({
        id,
        email: claims.email,
        emailVerified: claims.emailVerified,
        name: claims.name,
        lastLoginAt: now,
      })
      // Two first logins of one subject can race: the unique index lets one
      // win, the other rolls its user back and reads the winner's.
      const linked = await tx
        .insert(userIdentity)
        .values({ issuer: claims.issuer, subject: claims.subject, userId: id })
        .onConflictDoNothing()
        .returning({ userId: userIdentity.userId })
      if (linked.length === 0) {
        await tx.delete(appUser).where(eq(appUser.id, id))
        existing = await find()
      } else {
        created = true
        existing = { id, disabledAt: null }
      }
    }
    if (!existing) throw new OidcLoginError('jit_off')
    if (existing.disabledAt) throw new OidcLoginError('disabled')

    if (!created) {
      // The IdP is the source for these display fields; refreshing them never
      // changes who the user is.
      await tx
        .update(appUser)
        .set({
          email: claims.email,
          emailVerified: claims.emailVerified,
          name: claims.name,
          lastLoginAt: now,
        })
        .where(eq(appUser.id, existing.id))
    }
    return { id: existing.id, created }
  })
}
