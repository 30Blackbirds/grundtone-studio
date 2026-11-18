import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../../db'
import {
  appUser,
  auditLog,
  orgInvitation,
  orgMember,
  organization,
  userIdentity,
} from '../../db/schema'
import { auditRow } from '../audit'
import { INVITATION_TTL_MS } from '../local-orgs'

// The first owner of an organisation, set up by the OPERATOR (someone who can
// run a command against the database), never by a request. There is no open
// first-user window: a fresh deployment grants nothing to whoever signs in
// first. See docs/design/standalone-oidc.md.
//
// - The e-mail already belongs to a Studio user: that user becomes owner.
// - It does not: a one-use owner invitation bound to that e-mail is created and
//   its link is returned ONCE. It is accepted like any invitation, so it needs
//   the IdP to have verified that address (unless the deployment turned that
//   off, with the risk the design note describes).

const SLUG = /^[a-z0-9-]{1,100}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type BootstrapResult =
  | { kind: 'member'; organizationId: string; created: boolean }
  | { kind: 'invitation'; organizationId: string; created: boolean; token: string; expiresAt: Date }

export class BootstrapError extends Error {}

/**
 * Owner by IdP identity (issuer + subject), the form to prefer: it depends on
 * no e-mail address, so it cannot be claimed by whoever can register that
 * address at the IdP. The Studio user is created now with no e-mail; the first
 * login finds it by (issuer, subject) and fills in the claims. Idempotent.
 */
export async function bootstrapOwnerBySubject(
  db: Db,
  input: { issuer: string; subject: string; orgSlug: string; orgName?: string },
): Promise<{ organizationId: string; created: boolean; userCreated: boolean }> {
  const issuer = input.issuer.trim()
  const subject = input.subject.trim()
  if (!issuer || !subject || subject.length > 255)
    throw new BootstrapError('invalid issuer or subject')
  if (!SLUG.test(input.orgSlug)) throw new BootstrapError('invalid organisation slug')
  return db.transaction(async (tx) => {
    let [org] = await tx.select().from(organization).where(eq(organization.slug, input.orgSlug))
    let created = false
    if (!org) {
      const name = input.orgName?.trim()
      if (!name || name.length > 200) {
        throw new BootstrapError('organisation does not exist: pass a name to create it')
      }
      ;[org] = await tx
        .insert(organization)
        .values({ id: randomUUID(), name, slug: input.orgSlug })
        .returning()
      created = true
    }
    const orgId = org!.id
    const [known] = await tx
      .select({ userId: userIdentity.userId })
      .from(userIdentity)
      .where(and(eq(userIdentity.issuer, issuer), eq(userIdentity.subject, subject)))
    let userId = known?.userId
    if (!userId) {
      userId = randomUUID()
      await tx.insert(appUser).values({ id: userId })
      await tx.insert(userIdentity).values({ issuer, subject, userId })
    }
    await tx
      .insert(orgMember)
      .values({ organizationId: orgId, userId, role: 'owner' })
      .onConflictDoUpdate({
        target: [orgMember.organizationId, orgMember.userId],
        set: { role: 'owner' },
      })
    await tx.insert(auditLog).values(
      auditRow(null, {
        organizationId: orgId,
        action: 'member.added',
        targetType: 'organization',
        targetId: orgId,
        targetLabel: `sub:${subject}`,
        actorEmail: 'operator',
      }),
    )
    return { organizationId: orgId, created, userCreated: !known }
  })
}

export async function bootstrapOwner(
  db: Db,
  input: { email: string; orgSlug: string; orgName?: string },
  now = new Date(),
): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 320) throw new BootstrapError('invalid e-mail address')
  if (!SLUG.test(input.orgSlug)) throw new BootstrapError('invalid organisation slug')

  return db.transaction(async (tx) => {
    let [org] = await tx.select().from(organization).where(eq(organization.slug, input.orgSlug))
    let created = false
    if (!org) {
      const name = input.orgName?.trim()
      if (!name || name.length > 200) {
        throw new BootstrapError('organisation does not exist: pass a name to create it')
      }
      ;[org] = await tx
        .insert(organization)
        .values({ id: randomUUID(), name, slug: input.orgSlug })
        .returning()
      created = true
    }
    const orgId = org!.id
    const audit = (action: 'member.added' | 'member.invited', targetLabel: string) =>
      tx.insert(auditLog).values(
        auditRow(null, {
          organizationId: orgId,
          action,
          targetType: 'organization',
          targetId: orgId,
          targetLabel,
          actorEmail: 'operator',
        }),
      )

    const [user] = await tx
      .select({ id: appUser.id })
      .from(appUser)
      .where(sql`lower(${appUser.email}) = ${email}`)
    if (user) {
      await tx
        .insert(orgMember)
        .values({ organizationId: orgId, userId: user.id, role: 'owner' })
        .onConflictDoUpdate({
          target: [orgMember.organizationId, orgMember.userId],
          set: { role: 'owner' },
        })
      await audit('member.added', email)
      return { kind: 'member', organizationId: orgId, created } as const
    }

    await tx
      .update(orgInvitation)
      .set({ revokedAt: now })
      .where(
        and(
          eq(orgInvitation.organizationId, orgId),
          eq(orgInvitation.email, email),
          isNull(orgInvitation.acceptedAt),
          isNull(orgInvitation.revokedAt),
        ),
      )
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS)
    await tx.insert(orgInvitation).values({
      organizationId: orgId,
      email,
      role: 'owner',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      createdAt: now,
      expiresAt,
    })
    await audit('member.invited', email)
    return { kind: 'invitation', organizationId: orgId, created, token, expiresAt } as const
  })
}
