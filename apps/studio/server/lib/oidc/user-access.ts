import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db'
import { appSession, appUser, auditLog, orgMember, userIdentity } from '../../db/schema'
import { auditRow } from '../audit'
import { disableUser, enableUser } from './sessions'

// Disabling is an instance-operator action, not an organisation one: a person
// can belong to several organisations, so no single owner may lock them out of
// all of them. Only the operator command (server/db/user-access.ts) calls this.

export type UserRef = { sub: string; issuer: string } | { id: string } | { email: string }

export type UserAccessErrorCode = 'invalid_input' | 'not_found' | 'ambiguous'

export class UserAccessError extends Error {
  constructor(readonly code: UserAccessErrorCode) {
    super(
      code === 'ambiguous'
        ? 'more than one user has that e-mail address; use --sub or --id'
        : code === 'not_found'
          ? 'no such user'
          : 'invalid user reference',
    )
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const EMAIL = /^[^\s@]+@[^\s@]+$/

async function findUser(tx: Tx, ref: UserRef): Promise<{ id: string; disabled: boolean }> {
  const cols = { id: appUser.id, disabledAt: appUser.disabledAt }
  let rows: Array<{ id: string; disabledAt: Date | null }>
  if ('sub' in ref) {
    if (!ref.sub.trim() || !ref.issuer.trim()) throw new UserAccessError('invalid_input')
    rows = await tx
      .select(cols)
      .from(userIdentity)
      .innerJoin(appUser, eq(appUser.id, userIdentity.userId))
      .where(and(eq(userIdentity.issuer, ref.issuer), eq(userIdentity.subject, ref.sub)))
  } else if ('id' in ref) {
    if (!ref.id.trim()) throw new UserAccessError('invalid_input')
    rows = await tx.select(cols).from(appUser).where(eq(appUser.id, ref.id))
  } else {
    const email = ref.email.trim().toLowerCase()
    if (!EMAIL.test(email)) throw new UserAccessError('invalid_input')
    // Studio never merges two sign-ins by address, so one address can belong
    // to several users. Acting on "the" user would be a guess.
    rows = await tx
      .select(cols)
      .from(appUser)
      .where(sql`lower(${appUser.email}) = ${email}`)
      .limit(2)
    if (rows.length > 1) throw new UserAccessError('ambiguous')
  }
  const [row] = rows
  if (!row) throw new UserAccessError('not_found')
  return { id: row.id, disabled: !!row.disabledAt }
}

/**
 * Disable or enable a user, for the operator. Disabling refuses the last
 * enabled owner of any organisation (LastOwnerError, from disableUser).
 * Either way every session of the user is deleted, so a session left open by
 * a disable done by hand cannot come back: after enabling, the person signs in
 * anew. Each organisation the user belongs to gets one audit row per change.
 */
export async function setUserAccess(
  db: Db,
  ref: UserRef,
  action: 'disable' | 'enable',
  now = new Date(),
): Promise<{ userId: string; changed: boolean }> {
  return db.transaction(async (tx) => {
    const user = await findUser(tx, ref)
    const changed = action === 'disable' ? !user.disabled : user.disabled
    if (changed) {
      if (action === 'disable') await disableUser(tx as unknown as Db, user.id, now)
      else await enableUser(tx as unknown as Db, user.id)
      const memberships = await tx
        .select({ orgId: orgMember.organizationId, role: orgMember.role })
        .from(orgMember)
        .where(eq(orgMember.userId, user.id))
      for (const m of memberships) {
        await tx.insert(auditLog).values(
          auditRow(null, {
            organizationId: m.orgId,
            action: action === 'disable' ? 'member.disabled' : 'member.enabled',
            targetType: 'member',
            targetId: user.id,
            after: { role: m.role },
            actorEmail: 'operator',
          }),
        )
      }
    }
    await tx.delete(appSession).where(eq(appSession.userId, user.id))
    return { userId: user.id, changed }
  })
}
