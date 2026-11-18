import { createError, type H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { appUser, organization } from '../db/schema'
import { email as mailer } from './email'
import { localeFromEvent, orgInviteEmail } from './email-templates'
import * as store from './local-orgs'
import { LocalOrgError } from './local-orgs'
import { readOidcConfig } from './oidc/config'
import { canAssignRole, ORG_RANK } from './org-membership-input'
import type { OrgRole } from './project-access'

// The oidc-mode half of server/lib/org-membership.ts: the same operations the
// org routes call, answered by Studio's own tables (local-orgs.ts) instead of
// the auth service. org-membership.ts delegates here when AUTH_MODE=oidc. It
// adds only what a route must: the actor from the session, the HTTP status for
// each refusal, the creation policy and the invitation e-mail.

export function toHttp(err: unknown): never {
  if (!(err instanceof LocalOrgError)) throw err
  const e = (statusCode: number, statusMessage: string, code?: string) =>
    createError({ statusCode, statusMessage, ...(code ? { data: { code } } : {}) })
  switch (err.code) {
    case 'not_found':
      throw e(404, 'Not found')
    case 'forbidden':
      throw e(403, 'Requires a higher org role', 'org_role_rule')
    case 'slug_taken':
      throw e(409, 'That slug is taken', 'slug_taken')
    case 'last_owner':
      throw e(409, 'An organization must keep at least one enabled owner', 'last_owner')
    case 'org_not_empty':
      throw e(409, "Delete or move the organization's projects first", 'org_not_empty')
    case 'invalid_input':
      throw e(400, 'Invalid input')
    case 'invitation_invalid':
      throw e(404, 'Invitation not found')
    case 'email_unverified':
      throw e(
        403,
        'Your identity provider has not verified your e-mail address',
        'email_unverified',
      )
    case 'too_many_invitations':
      throw e(429, 'Too many pending invitations')
  }
}

function actorOf(event: H3Event): store.Actor {
  const a = event.context.auth
  if (!a) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return { id: a.sub, email: a.email ?? null }
}

/**
 * Who may create an organisation. `operator` (the default in oidc mode) means
 * nobody through the API: the instance operator creates organisations from the
 * command line, so an IdP that admits anyone cannot fill the instance with
 * organisations. `users` lets any signed-in user.
 */
export function orgCreationPolicy(env: Record<string, string | undefined> = process.env) {
  const raw = env.ORG_CREATION?.trim()
  if (!raw || raw === 'operator') return 'operator'
  if (raw === 'users') return 'users'
  throw new Error('ORG_CREATION must be operator or users')
}

export async function createOrganizationLocal(
  db: Db,
  event: H3Event,
  input: { name: string; slug: string },
) {
  const actor = actorOf(event)
  if (orgCreationPolicy() !== 'users') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Organizations are created by the instance operator',
      data: { code: 'org_creation_disabled' },
    })
  }
  try {
    return await store.createOrganization(db, actor, input)
  } catch (err) {
    toHttp(err)
  }
}

export async function inviteMemberLocal(
  db: Db,
  event: H3Event,
  orgId: string,
  input: { email: string; role: OrgRole },
) {
  const actor = actorOf(event)
  let inv: Awaited<ReturnType<typeof store.createInvitation>>
  try {
    inv = await store.createInvitation(db, actor, orgId, input)
  } catch (err) {
    toHttp(err)
  }
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
  const base = (process.env.NUXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  // The token is the invitation's secret: it travels only in this e-mail (or,
  // with SMTP_HOST empty, the server log), never in the API response.
  const mail = orgInviteEmail(
    {
      acceptUrl: `${base}/invitations/${inv.token}`,
      orgName: org?.name ?? '',
      inviterDisplay: actor.email ?? 'Someone',
    },
    localeFromEvent(event),
  )
  await mailer.send({ to: input.email, ...mail })
  return { id: inv.id, expiresAt: inv.expiresAt }
}

export async function acceptInvitationLocal(db: Db, event: H3Event, token: string) {
  const actor = actorOf(event)
  const [u] = await db
    .select({ email: appUser.email, emailVerified: appUser.emailVerified })
    .from(appUser)
    .where(eq(appUser.id, actor.id))
  if (!u) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  try {
    return await store.acceptInvitation(
      db,
      { id: actor.id, email: u.email, emailVerified: u.emailVerified },
      token,
      { requireEmailVerified: readOidcConfig().requireEmailVerified },
    )
  } catch (err) {
    toHttp(err)
  }
}

export async function changeMemberRoleLocal(
  db: Db,
  event: H3Event,
  orgId: string,
  memberId: string,
  role: OrgRole,
) {
  try {
    await store.changeMemberRole(db, actorOf(event), orgId, memberId, role)
  } catch (err) {
    toHttp(err)
  }
  return { ok: true }
}

export async function removeMemberLocal(db: Db, event: H3Event, orgId: string, memberId: string) {
  try {
    await store.removeMember(db, actorOf(event), orgId, memberId)
  } catch (err) {
    toHttp(err)
  }
  return { ok: true }
}

export async function leaveOrganizationLocal(db: Db, event: H3Event, orgId: string) {
  try {
    await store.leaveOrganization(db, actorOf(event), orgId)
  } catch (err) {
    toHttp(err)
  }
  return { ok: true }
}

export async function transferOwnershipLocal(
  db: Db,
  event: H3Event,
  orgId: string,
  targetUserId: string,
  stepDownTo?: OrgRole,
) {
  try {
    await store.transferOwnership(db, actorOf(event), orgId, targetUserId, stepDownTo)
  } catch (err) {
    toHttp(err)
  }
  return { ok: true }
}

/** The caller's role and the roles it may give, for the member pages. */
export async function myRolesLocal(db: Db, event: H3Event, orgId: string) {
  let role: OrgRole
  try {
    role = await store.roleOf(db, actorOf(event), orgId)
  } catch (err) {
    toHttp(err)
  }
  const mayManage = role === 'owner' || role === 'manager'
  return {
    role,
    assignable: mayManage ? ORG_RANK.filter((r) => canAssignRole(role, r)) : [],
    mayTransferOwnership: role === 'owner',
  }
}

export async function deleteOrganizationLocal(db: Db, event: H3Event, orgId: string) {
  try {
    await store.deleteOrganization(db, actorOf(event), orgId)
  } catch (err) {
    toHttp(err)
  }
  return { ok: true }
}
