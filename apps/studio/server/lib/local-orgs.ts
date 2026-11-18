import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, count, eq, gt, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import {
  appUser,
  auditLog,
  orgInvitation,
  orgMember,
  orgMemberClaim,
  organization,
  project,
} from '../db/schema'
import { auditRow, type AuditEventInput } from './audit'
import { canAssignRole, canManageMember, ORG_RANK } from './org-membership-input'
import type { OrgRole } from './project-access'

// Studio-owned organisations, members and invitations (AUTH_MODE=oidc). The
// better-auth mode keeps these in the auth service (org-membership.ts); nothing
// here is called there. See docs/design/standalone-oidc.md.
//
// 🔴 THE RULES LIVE HERE, NOT IN THE ROUTES. Every function takes the ACTOR and
// the organisation id and decides from org_member INSIDE its own transaction:
//
//   - an actor who is not a member of the organisation gets `not_found`, the same
//     answer as for an organisation that does not exist, so ids of other tenants
//     cannot be probed;
//   - every row touched is selected by (organization id AND its own id), so an id
//     from another organisation can never be reached through this one;
//   - the organisation row is locked FOR UPDATE for any change of who holds a
//     role, so two concurrent changes cannot both pass the last-owner check.
//
// Last-owner protection: a change that would leave an organisation with no
// ENABLED owner is refused (`last_owner`). A disabled user does not count.

export type LocalOrgErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'slug_taken'
  | 'last_owner'
  | 'invalid_input'
  | 'org_not_empty'
  | 'invitation_invalid'
  | 'email_unverified'
  | 'too_many_invitations'

export class LocalOrgError extends Error {
  constructor(
    readonly code: LocalOrgErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'LocalOrgError'
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface Actor {
  id: string
  email?: string | null
}

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_PENDING_INVITATIONS = 200

const SLUG = /^[a-z0-9-]{1,100}$/
const hash = (token: string): string => createHash('sha256').update(token).digest('hex')
const isRole = (v: unknown): v is OrgRole => ORG_RANK.includes(v as OrgRole)

const audit = (actor: Actor, input: AuditEventInput) =>
  auditRow(null, {
    ...input,
    actorUserId: actor.id,
    ...(actor.email ? { actorEmail: actor.email } : {}),
  })

/** The actor's role in the org, or not_found (never "exists but not yours"). */
async function roleIn(tx: Tx, orgId: string, userId: string): Promise<OrgRole> {
  const [row] = await tx
    .select({ role: orgMember.role })
    .from(orgMember)
    .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, userId)))
  if (!row || !isRole(row.role)) throw new LocalOrgError('not_found')
  return row.role
}

/** Locks the organisation row; not_found when it does not exist. */
async function lockOrg(tx: Tx, orgId: string) {
  const [org] = await tx.select().from(organization).where(eq(organization.id, orgId)).for('update')
  if (!org) throw new LocalOrgError('not_found')
  return org
}

/**
 * Any change to a member made in Studio makes that row Studio's: the IdP role
 * claim (oidc/claim-roles.ts) stops managing it.
 */
async function unmarkClaim(tx: Tx, orgId: string, userId: string) {
  await tx
    .delete(orgMemberClaim)
    .where(and(eq(orgMemberClaim.organizationId, orgId), eq(orgMemberClaim.userId, userId)))
}

const mayManage = (role: OrgRole) => role === 'owner' || role === 'manager'

/** Enabled owners of the org, optionally leaving one user out. */
async function enabledOwners(tx: Tx, orgId: string, except?: string): Promise<number> {
  const rows = await tx
    .select({ userId: orgMember.userId, disabledAt: appUser.disabledAt })
    .from(orgMember)
    .leftJoin(appUser, eq(appUser.id, orgMember.userId))
    .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.role, 'owner')))
  return rows.filter((r) => r.userId !== except && !r.disabledAt).length
}

async function assertOwnerRemains(tx: Tx, orgId: string, leaving: string, was: OrgRole) {
  if (was === 'owner' && (await enabledOwners(tx, orgId, leaving)) === 0) {
    throw new LocalOrgError('last_owner')
  }
}

// ─── organisations ───────────────────────────────────────────────────────────

export interface OrgView {
  id: string
  name: string
  slug: string
  createdAt: Date
}

export async function createOrganization(
  db: Db,
  actor: Actor,
  input: { name: string; slug: string },
): Promise<OrgView> {
  const name = input.name.trim()
  if (!name || name.length > 200 || !SLUG.test(input.slug)) throw new LocalOrgError('invalid_input')
  return db.transaction(async (tx) => {
    const id = randomUUID()
    const [org] = await tx
      .insert(organization)
      .values({ id, name, slug: input.slug })
      .onConflictDoNothing()
      .returning()
    if (!org) throw new LocalOrgError('slug_taken')
    await tx.insert(orgMember).values({ organizationId: id, userId: actor.id, role: 'owner' })
    await tx.insert(auditLog).values(
      audit(actor, {
        organizationId: id,
        action: 'organization.created',
        targetType: 'organization',
        targetId: id,
        targetLabel: name,
      }),
    )
    return org
  })
}

/** An org by id or slug, only if `userId` is a member of it. */
export async function getOrganization(
  db: Db,
  userId: string,
  by: { id: string } | { slug: string },
): Promise<(OrgView & { role: OrgRole }) | null> {
  const where = 'id' in by ? eq(organization.id, by.id) : eq(organization.slug, by.slug)
  const [row] = await db
    .select({ org: organization, role: orgMember.role })
    .from(organization)
    .innerJoin(
      orgMember,
      and(eq(orgMember.organizationId, organization.id), eq(orgMember.userId, userId)),
    )
    .where(where)
  return row && isRole(row.role) ? { ...row.org, role: row.role } : null
}

/** Every org the user belongs to. */
export async function listOrganizations(db: Db, userId: string): Promise<OrgView[]> {
  const rows = await db
    .select({ org: organization })
    .from(organization)
    .innerJoin(
      orgMember,
      and(eq(orgMember.organizationId, organization.id), eq(orgMember.userId, userId)),
    )
  return rows.map((r) => r.org)
}

/** Delete an org. Owner only; refused while it still has projects. */
export async function deleteOrganization(db: Db, actor: Actor, orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const org = await lockOrg(tx, orgId)
    const role = await roleIn(tx, orgId, actor.id)
    if (role !== 'owner') throw new LocalOrgError('forbidden')
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(project)
      .where(eq(project.organizationId, orgId))
    if (n > 0) throw new LocalOrgError('org_not_empty')
    await tx.delete(orgMember).where(eq(orgMember.organizationId, orgId))
    await tx.delete(organization).where(eq(organization.id, orgId))
    await tx.insert(auditLog).values(
      audit(actor, {
        organizationId: orgId,
        action: 'organization.deleted',
        targetType: 'organization',
        targetId: orgId,
        targetLabel: org.name,
      }),
    )
  })
}

// ─── members ─────────────────────────────────────────────────────────────────

export interface MemberView {
  userId: string
  role: OrgRole
  email: string | null
  name: string | null
  disabled: boolean
}

/** Members of an org, to any member of it. */
export async function listMembers(db: Db, actor: Actor, orgId: string): Promise<MemberView[]> {
  return db.transaction(async (tx) => {
    await roleIn(tx, orgId, actor.id)
    const rows = await tx
      .select({
        userId: orgMember.userId,
        role: orgMember.role,
        email: appUser.email,
        name: appUser.name,
        disabledAt: appUser.disabledAt,
      })
      .from(orgMember)
      .leftJoin(appUser, eq(appUser.id, orgMember.userId))
      .where(eq(orgMember.organizationId, orgId))
    return rows
      .filter((r): r is typeof r & { role: OrgRole } => isRole(r.role))
      .map((r) => ({
        userId: r.userId,
        role: r.role,
        email: r.email,
        name: r.name,
        disabled: r.disabledAt !== null,
      }))
  })
}

export async function changeMemberRole(
  db: Db,
  actor: Actor,
  orgId: string,
  targetUserId: string,
  role: OrgRole,
): Promise<void> {
  if (!isRole(role)) throw new LocalOrgError('invalid_input')
  await db.transaction(async (tx) => {
    await lockOrg(tx, orgId)
    const actorRole = await roleIn(tx, orgId, actor.id)
    if (!mayManage(actorRole)) throw new LocalOrgError('forbidden')
    let current: OrgRole
    try {
      current = await roleIn(tx, orgId, targetUserId)
    } catch {
      throw new LocalOrgError('not_found')
    }
    if (!canManageMember(actorRole, current) || !canAssignRole(actorRole, role)) {
      throw new LocalOrgError('forbidden')
    }
    if (current === role) return
    if (role !== 'owner') await assertOwnerRemains(tx, orgId, targetUserId, current)
    await tx
      .update(orgMember)
      .set({ role })
      .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, targetUserId)))
    await unmarkClaim(tx, orgId, targetUserId)
    await tx.insert(auditLog).values(
      audit(actor, {
        organizationId: orgId,
        action: 'member.role_changed',
        targetType: 'member',
        targetId: targetUserId,
        before: { role: current },
        after: { role },
      }),
    )
  })
}

export async function removeMember(
  db: Db,
  actor: Actor,
  orgId: string,
  targetUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOrg(tx, orgId)
    const actorRole = await roleIn(tx, orgId, actor.id)
    if (!mayManage(actorRole)) throw new LocalOrgError('forbidden')
    let current: OrgRole
    try {
      current = await roleIn(tx, orgId, targetUserId)
    } catch {
      throw new LocalOrgError('not_found')
    }
    if (!canManageMember(actorRole, current)) throw new LocalOrgError('forbidden')
    await assertOwnerRemains(tx, orgId, targetUserId, current)
    await tx
      .delete(orgMember)
      .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, targetUserId)))
    await unmarkClaim(tx, orgId, targetUserId)
    await tx.insert(auditLog).values(
      audit(actor, {
        organizationId: orgId,
        action: 'member.removed',
        targetType: 'member',
        targetId: targetUserId,
        before: { role: current },
      }),
    )
  })
}

/** Any member may leave, unless they are the last enabled owner. */
export async function leaveOrganization(db: Db, actor: Actor, orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOrg(tx, orgId)
    const role = await roleIn(tx, orgId, actor.id)
    await assertOwnerRemains(tx, orgId, actor.id, role)
    await tx
      .delete(orgMember)
      .where(and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, actor.id)))
    await unmarkClaim(tx, orgId, actor.id)
    await tx.insert(auditLog).values(
      audit(actor, {
        organizationId: orgId,
        action: 'member.left',
        targetType: 'member',
        targetId: actor.id,
        before: { role },
      }),
    )
  })
}

// ─── invitations ─────────────────────────────────────────────────────────────

export interface InvitationView {
  id: string
  email: string
  role: OrgRole
  createdAt: Date
  expiresAt: Date
}

const normEmail = (e: string) => e.trim().toLowerCase()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Invite an e-mail address. Returns the plaintext token ONCE (for the link);
 * only its hash is stored. A new invitation replaces any pending one for the
 * same address in the same organisation.
 */
export async function createInvitation(
  db: Db,
  actor: Actor,
  orgId: string,
  input: { email: string; role: OrgRole },
  now = new Date(),
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const email = normEmail(input.email)
  if (!EMAIL.test(email) || email.length > 320 || !isRole(input.role)) {
    throw new LocalOrgError('invalid_input')
  }
  return db.transaction(async (tx) => {
    await lockOrg(tx, orgId)
    const actorRole = await roleIn(tx, orgId, actor.id)
    if (!mayManage(actorRole) || !canAssignRole(actorRole, input.role)) {
      throw new LocalOrgError('forbidden')
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
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(orgInvitation)
      .where(pending(orgId, now))
    if (n >= MAX_PENDING_INVITATIONS) throw new LocalOrgError('too_many_invitations')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS)
    const [row] = await tx
      .insert(orgInvitation)
      .values({
        organizationId: orgId,
        email,
        role: input.role,
        tokenHash: hash(token),
        invitedBy: actor.id,
        createdAt: now,
        expiresAt,
      })
      .returning({ id: orgInvitation.id })
    await tx.insert(auditLog).values(
      audit(actor, {
        organizationId: orgId,
        action: 'member.invited',
        targetType: 'invitation',
        targetId: row!.id,
        targetLabel: email,
        after: { role: input.role },
      }),
    )
    return { id: row!.id, token, expiresAt }
  })
}

const pending = (orgId: string, now: Date) =>
  and(
    eq(orgInvitation.organizationId, orgId),
    isNull(orgInvitation.acceptedAt),
    isNull(orgInvitation.revokedAt),
    gt(orgInvitation.expiresAt, now),
  )

export async function listInvitations(
  db: Db,
  actor: Actor,
  orgId: string,
  now = new Date(),
): Promise<InvitationView[]> {
  return db.transaction(async (tx) => {
    if (!mayManage(await roleIn(tx, orgId, actor.id))) throw new LocalOrgError('forbidden')
    const rows = await tx.select().from(orgInvitation).where(pending(orgId, now))
    return rows
      .filter((r): r is typeof r & { role: OrgRole } => isRole(r.role))
      .map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }))
  })
}

export async function revokeInvitation(
  db: Db,
  actor: Actor,
  orgId: string,
  invitationId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const actorRole = await roleIn(tx, orgId, actor.id)
    if (!mayManage(actorRole)) throw new LocalOrgError('forbidden')
    // Selected by org AND id: an invitation of another organisation is not found.
    const [inv] = await tx
      .select()
      .from(orgInvitation)
      .where(and(eq(orgInvitation.organizationId, orgId), eq(orgInvitation.id, invitationId)))
    if (!inv) throw new LocalOrgError('not_found')
    // A manager may not withdraw an invitation to a rank they could not grant.
    if (!isRole(inv.role) || !canAssignRole(actorRole, inv.role)) {
      throw new LocalOrgError('forbidden')
    }
    const done = await tx
      .update(orgInvitation)
      .set({ revokedAt: now })
      .where(
        and(
          eq(orgInvitation.id, inv.id),
          isNull(orgInvitation.acceptedAt),
          isNull(orgInvitation.revokedAt),
        ),
      )
      .returning({ id: orgInvitation.id })
    if (done.length === 0) throw new LocalOrgError('not_found')
    await tx.insert(auditLog).values(
      audit(actor, {
        organizationId: orgId,
        action: 'member.invite_cancelled',
        targetType: 'invitation',
        targetId: inv.id,
        targetLabel: inv.email,
      }),
    )
  })
}

/**
 * Accept an invitation by its token. The signed-in user's e-mail must match the
 * invited one, and, when `requireEmailVerified`, the IdP must vouch for it.
 * Every other failure is the same `invitation_invalid`, so a wrong, used,
 * revoked, expired or someone else's token cannot be told apart.
 *
 * The role is the invitation's, never one from the request. An existing member
 * is never lowered by accepting.
 */
export async function acceptInvitation(
  db: Db,
  user: { id: string; email: string | null; emailVerified: boolean },
  token: string,
  opts: { requireEmailVerified: boolean },
  now = new Date(),
): Promise<{ organizationId: string; role: OrgRole }> {
  if (!token || token.length > 200) throw new LocalOrgError('invitation_invalid')
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(orgInvitation)
      .where(eq(orgInvitation.tokenHash, hash(token)))
    if (
      !inv ||
      inv.acceptedAt ||
      inv.revokedAt ||
      inv.expiresAt.getTime() <= now.getTime() ||
      !isRole(inv.role) ||
      !user.email ||
      normEmail(user.email) !== inv.email
    ) {
      throw new LocalOrgError('invitation_invalid')
    }
    if (opts.requireEmailVerified && !user.emailVerified)
      throw new LocalOrgError('email_unverified')

    await lockOrg(tx, inv.organizationId).catch(() => {
      throw new LocalOrgError('invitation_invalid')
    })
    // Consumed in one statement: two concurrent accepts cannot both win.
    const used = await tx
      .update(orgInvitation)
      .set({ acceptedAt: now })
      .where(
        and(
          eq(orgInvitation.id, inv.id),
          isNull(orgInvitation.acceptedAt),
          isNull(orgInvitation.revokedAt),
        ),
      )
      .returning({ id: orgInvitation.id })
    if (used.length === 0) throw new LocalOrgError('invitation_invalid')

    const [existing] = await tx
      .select({ role: orgMember.role })
      .from(orgMember)
      .where(and(eq(orgMember.organizationId, inv.organizationId), eq(orgMember.userId, user.id)))
    const keep =
      existing &&
      isRole(existing.role) &&
      ORG_RANK.indexOf(existing.role) >= ORG_RANK.indexOf(inv.role)
    const role = keep ? (existing!.role as OrgRole) : inv.role
    if (!existing) {
      await tx
        .insert(orgMember)
        .values({ organizationId: inv.organizationId, userId: user.id, role })
    } else if (!keep) {
      await tx
        .update(orgMember)
        .set({ role })
        .where(and(eq(orgMember.organizationId, inv.organizationId), eq(orgMember.userId, user.id)))
    }
    // An accepted invitation is Studio's decision, even when it kept a higher role.
    await unmarkClaim(tx, inv.organizationId, user.id)
    await tx.insert(auditLog).values(
      audit(
        { id: user.id, email: user.email },
        {
          organizationId: inv.organizationId,
          action: 'member.invite_accepted',
          targetType: 'invitation',
          targetId: inv.id,
          after: { role },
        },
      ),
    )
    return { organizationId: inv.organizationId, role }
  })
}
