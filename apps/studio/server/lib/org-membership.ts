import { and, eq } from 'drizzle-orm'
import { createError, getRequestHeader, type H3Event } from 'h3'
import type { Db } from '../db'
import { auditLog, orgMember } from '../db/schema'
import { auditRow, type AuditEventInput } from './audit'
import { canAssignRole, canManageMember } from './org-membership-input'
import { recordOrgWriteIncomplete } from './metrics'
import { ORG_ROLES, orgRoleHelpers, type OrgRole } from './project-access'

// Studio's writes of org membership. Every change of who holds which org role
// goes through here, so that org_member always follows it.
//
// TWO SYSTEMS. Auth keeps its own member table: the active org and the JWT's
// tenant claim depend on it, and auth's hooks mirror it into the permissions
// service. So each change is written twice: to auth, through its organization
// API with the user's own session (auth still decides whether the actor may do
// it), and to org_member. Postgres and auth share no transaction, so the ORDER
// is chosen so that NO failure leaves studio allowing more than auth does:
//
//   grant    (create org, accept invitation, a role change that only adds
//            rights): auth FIRST; studio writes the row (and its audit row, in
//            one transaction) only after auth said yes. Auth refuses or does not
//            answer: nothing is written. Auth said yes and studio's write fails:
//            the row is missing, so studio denies (fail-closed).
//
//   revoke   (delete org, remove member, leave, a role change that takes any
//            right away): studio's row is removed and COMMITTED FIRST, then auth
//            is called. Auth refuses (4xx): the removed row is put back. Auth's
//            answer is unknown (network, 5xx, where auth may have committed):
//            the row stays removed, 502 `auth_pending`. Auth said yes: for a role
//            change the new role is written now, after auth agreed, so a right
//            the new role adds (admin -> billing gains billing) is never held
//            before auth holds it. Any failure after the first commit leaves too
//            little access, never too much.
//
// Every fail-closed ending is counted (recordOrgWriteIncomplete) and logged.
// What is left behind is found by comparing auth's members with org_member.

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Exec = Db | Tx

/** Auth answered with a 4xx: it decided, and nothing changed there. */
export class AuthRefused extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(`auth refused with ${status}`)
  }
}

/** Auth's answer never arrived or was a 5xx: whether it changed is unknown. */
export class AuthOutcomeUnknown extends Error {}

/** One call to auth's organization API, e.g. `('remove-member', {...})`. */
export type AuthCall = (path: string, body: Record<string, unknown>) => Promise<unknown>

export interface MembershipDeps {
  db: Db
  auth: AuthCall
  /** Auth's view of an org's members, to learn whom a member id names. */
  members: (orgId: string) => Promise<Array<{ id: string; userId: string; role: string }> | null>
  /** Inserts the audit row; a test can make it fail to stand in for a failed commit. */
  audit?: (exec: Exec, row: typeof auditLog.$inferInsert) => Promise<void>
}

const AUTH_TIMEOUT_MS = 10_000

/**
 * The header auth will require on its org-membership writes (ClickUp
 * 1amk32fna12), so that only studio's server can make them. Its value is a
 * server-only secret: read from process.env here, never from public runtime
 * config, and never attached by the generic /api/auth proxy.
 */
export const ORG_WRITE_CREDENTIAL_HEADER = 'x-klanghaus-org-write-credential'

/** Where and how studio's server reaches auth for org writes (membershipDeps). */
export interface OrgWriteTarget {
  /** AUTH_INTERNAL_URL only: these calls never go to the public issuer. */
  base: string
  /** ORG_WRITE_SERVICE_SECRET; never empty (membershipDeps refuses that). */
  credential: string
}

/**
 * Calls auth as the signed-in user: the request's own cookie and origin (auth
 * checks the origin of cookie POSTs), plus the org-write credential. The
 * credential is never logged: errors below carry auth's status and data only.
 */
export function authCaller(event: H3Event, target: OrgWriteTarget): AuthCall {
  const cookie = getRequestHeader(event, 'cookie')
  const origin = getRequestHeader(event, 'origin')
  return async (path, body) => {
    try {
      return await $fetch(`${target.base}/api/auth/organization/${path}`, {
        method: 'POST',
        body,
        timeout: AUTH_TIMEOUT_MS,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(origin ? { origin } : {}),
          [ORG_WRITE_CREDENTIAL_HEADER]: target.credential,
        },
      })
    } catch (err) {
      const e = err as { status?: number; statusCode?: number; data?: unknown }
      const status = e?.status ?? e?.statusCode
      if (status && status >= 400 && status < 500) throw new AuthRefused(status, e.data)
      // A 5xx is NOT "nothing happened": auth may have committed and lost the
      // response. It is unknown, like a timeout.
      throw new AuthOutcomeUnknown(status ? `auth answered ${status}` : 'auth did not answer')
    }
  }
}

const insertAudit = async (exec: Exec, row: typeof auditLog.$inferInsert) => {
  await exec.insert(auditLog).values(row)
}

function authError(err: unknown): never {
  if (err instanceof AuthRefused) {
    const data = err.data as { message?: string; code?: string } | null
    throw createError({
      statusCode: err.status,
      statusMessage: data?.message ?? 'Refused by auth',
      data: { code: data?.code ?? 'auth_refused' },
    })
  }
  if (err instanceof AuthOutcomeUnknown) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Auth did not answer; nothing was changed',
      data: { code: 'auth_unavailable' },
    })
  }
  throw err
}

// What a role can do, from the same rules studio decides by: project rights
// from the permissions model, org rights from orgRoleHelpers.
function rights(role: OrgRole): Set<string> {
  const r = new Set<string>()
  if (orgRoleHelpers.canViewProjects(role)) r.add('project:view')
  if (role === 'owner' || role === 'manager') r.add('project:edit').add('project:admin')
  if (orgRoleHelpers.canManageOrgMembers(role)) r.add('org:members')
  if (orgRoleHelpers.canManageBilling(role)) r.add('org:billing')
  if (orgRoleHelpers.canCreateProjects(role)) r.add('org:create_projects')
  if (role === 'owner') r.add('org:delete')
  return r
}

/** True when `to` keeps every right `from` had: the change only adds. */
export function onlyAdds(from: OrgRole, to: OrgRole): boolean {
  const target = rights(to)
  return [...rights(from)].every((x) => target.has(x))
}

export function isOrgRole(role: unknown): role is OrgRole {
  return typeof role === 'string' && (ORG_ROLES as readonly string[]).includes(role)
}

async function grant<T>(
  deps: MembershipDeps,
  path: string,
  body: Record<string, unknown>,
  write: (tx: Tx, answer: T) => Promise<AuditEventInput>,
  event: H3Event | null,
): Promise<T> {
  const audit = deps.audit ?? insertAudit
  let answer: T
  try {
    answer = (await deps.auth(path, body)) as T
  } catch (err) {
    authError(err)
  }
  try {
    return await deps.db.transaction(async (tx) => {
      const entry = await write(tx, answer)
      await audit(tx, auditRow(event, entry))
      return answer
    })
  } catch (err) {
    // A 502 badAnswer is already a deliberate refusal to record; anything else
    // is studio failing after auth said yes. Either way the row is missing.
    if ((err as { data?: { code?: string } })?.data?.code !== 'auth_unexpected_answer') {
      recordOrgWriteIncomplete('not_recorded')
      console.error('[org-membership] auth said yes to', path, 'and studio did not record it')
    }
    throw err
  }
}

type MemberRow = typeof orgMember.$inferSelect

interface RevokeSteps {
  /** Removes the rows that hold the right; returns them so they can be put back. */
  remove: (tx: Tx) => Promise<MemberRow[]>
  /** After auth said yes: what the change leaves (a role change's new role). */
  apply?: (tx: Tx) => Promise<void>
  entry: AuditEventInput
}

async function revoke<T>(
  deps: MembershipDeps,
  path: string,
  body: Record<string, unknown>,
  steps: RevokeSteps,
  event: H3Event | null,
): Promise<T> {
  const audit = deps.audit ?? insertAudit
  // 1. Studio drops the right and commits, before auth is asked.
  const removed = await deps.db.transaction((tx) => steps.remove(tx))

  // 2. Auth.
  let answer: T
  try {
    answer = (await deps.auth(path, body)) as T
  } catch (err) {
    if (err instanceof AuthRefused) {
      // Auth decided no: nothing changed there, so put studio's rows back.
      try {
        if (removed.length) await deps.db.insert(orgMember).values(removed).onConflictDoNothing()
      } catch {
        recordOrgWriteIncomplete('restore_failed')
        console.error('[org-membership] could not restore org_member after a refused', path)
      }
      authError(err)
    }
    if (err instanceof AuthOutcomeUnknown) {
      recordOrgWriteIncomplete('auth_pending')
      try {
        await audit(deps.db, auditRow(event, { ...steps.entry, after: { authPending: true } }))
      } catch {
        // The access state is already the safe one; the audit row is not.
      }
      throw createError({
        statusCode: 502,
        statusMessage: 'Removed in studio; auth did not confirm it',
        data: { code: 'auth_pending' },
      })
    }
    throw err
  }

  // 3. Auth said yes: write what the change leaves, and the audit row.
  try {
    await deps.db.transaction(async (tx) => {
      if (steps.apply) await steps.apply(tx)
      await audit(tx, auditRow(event, steps.entry))
    })
  } catch {
    recordOrgWriteIncomplete('not_recorded')
    console.error('[org-membership] auth said yes to', path, 'and studio did not record it')
    throw createError({
      statusCode: 500,
      statusMessage: 'Changed in auth; studio holds less access than auth until it is recorded',
      data: { code: 'org_member_not_recorded' },
    })
  }
  return answer
}

const rowOf = (orgId: string, userId: string) =>
  and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, userId))

const deleteRow = (orgId: string, userId: string) => (tx: Tx) =>
  tx.delete(orgMember).where(rowOf(orgId, userId)).returning()

function badAnswer(what: string): never {
  // Auth said yes but not in a form studio can record: nothing is written, so
  // studio denies (fail-closed), and the comparison with auth will show it.
  throw createError({
    statusCode: 502,
    statusMessage: `Auth answered ${what} in an unexpected form`,
    data: { code: 'auth_unexpected_answer' },
  })
}

async function memberOf(deps: MembershipDeps, orgId: string, memberId: string) {
  const members = await deps.members(orgId)
  const m = members?.find((x) => x.id === memberId)
  if (!m) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  return m
}

function forbidden(reason: string): never {
  throw createError({ statusCode: 403, statusMessage: reason, data: { code: 'org_role_rule' } })
}

// The members page's rules (org-membership-input.ts). A role studio does not
// know counts as owner-rank: only an owner may touch it.
function assertMayManage(actorRole: OrgRole, current: string) {
  if (!canManageMember(actorRole, isOrgRole(current) ? current : 'owner')) {
    forbidden('Requires a higher org role than the member has')
  }
}

// ─── the operations ──────────────────────────────────────────────────────────

export async function createOrganization(
  deps: MembershipDeps,
  event: H3Event,
  actorId: string,
  input: { name: string; slug: string },
) {
  return grant<{ id?: string; name?: string }>(
    deps,
    'create',
    { name: input.name, slug: input.slug },
    async (tx, org) => {
      if (!org?.id) badAnswer('create')
      await tx.insert(orgMember).values({ organizationId: org.id, userId: actorId, role: 'owner' })
      return {
        organizationId: org.id,
        action: 'organization.created',
        targetType: 'organization',
        targetId: org.id,
        targetLabel: org.name ?? input.name,
      }
    },
    event,
  )
}

export async function acceptInvitation(
  deps: MembershipDeps,
  event: H3Event,
  actorId: string,
  invitationId: string,
) {
  type Answer = { member?: { userId?: string; organizationId?: string; role?: string } }
  return grant<Answer>(
    deps,
    'accept-invitation',
    { invitationId },
    async (tx, res) => {
      const m = res?.member
      // The role is the one auth recorded, never one from the request.
      if (!m?.organizationId || m.userId !== actorId || !isOrgRole(m.role)) {
        badAnswer('accept-invitation')
      }
      await tx
        .insert(orgMember)
        .values({ organizationId: m.organizationId, userId: actorId, role: m.role })
        .onConflictDoUpdate({
          target: [orgMember.organizationId, orgMember.userId],
          set: { role: m.role },
        })
      return {
        organizationId: m.organizationId,
        action: 'member.invite_accepted',
        targetType: 'invitation',
        targetId: invitationId,
        after: { role: m.role },
      }
    },
    event,
  )
}

export async function changeMemberRole(
  deps: MembershipDeps,
  event: H3Event,
  actorRole: OrgRole,
  orgId: string,
  memberId: string,
  role: OrgRole,
) {
  const m = await memberOf(deps, orgId, memberId)
  assertMayManage(actorRole, m.role)
  if (!canAssignRole(actorRole, role)) forbidden('Requires a higher org role than the one given')
  const from = isOrgRole(m.role) ? m.role : null
  const body = { memberId, role, organizationId: orgId }
  const entry: AuditEventInput = {
    organizationId: orgId,
    action: 'member.role_changed',
    targetType: 'member',
    targetId: m.userId,
    before: { role: m.role },
    after: { role },
  }
  const setRole = async (exec: Exec) => {
    await exec
      .insert(orgMember)
      .values({ organizationId: orgId, userId: m.userId, role })
      .onConflictDoUpdate({ target: [orgMember.organizationId, orgMember.userId], set: { role } })
  }
  // A role studio does not know is treated as holding every right, so any
  // change away from it takes the revoke path.
  if (from && onlyAdds(from, role)) {
    return grant(
      deps,
      'update-member-role',
      body,
      async (tx) => {
        await setRole(tx)
        return entry
      },
      event,
    )
  }
  // Revoke path: the row goes first, and the new role is written only after
  // auth agreed, so no right of the new role is held early.
  return revoke(
    deps,
    'update-member-role',
    body,
    { remove: deleteRow(orgId, m.userId), apply: setRole, entry },
    event,
  )
}

export async function removeMember(
  deps: MembershipDeps,
  event: H3Event,
  actorRole: OrgRole,
  orgId: string,
  memberId: string,
) {
  const m = await memberOf(deps, orgId, memberId)
  assertMayManage(actorRole, m.role)
  return revoke(
    deps,
    'remove-member',
    { memberIdOrEmail: memberId, organizationId: orgId },
    {
      remove: deleteRow(orgId, m.userId),
      entry: {
        organizationId: orgId,
        action: 'member.removed',
        targetType: 'member',
        targetId: m.userId,
        before: { role: m.role },
      },
    },
    event,
  )
}

export async function leaveOrganization(
  deps: MembershipDeps,
  event: H3Event,
  actorId: string,
  orgId: string,
) {
  // Auth fires no hook on leave, so this route is the only thing that ends a
  // leaver's org role in studio.
  return revoke(
    deps,
    'leave',
    { organizationId: orgId },
    {
      remove: deleteRow(orgId, actorId),
      entry: {
        organizationId: orgId,
        action: 'member.left',
        targetType: 'member',
        targetId: actorId,
      },
    },
    event,
  )
}

export async function deleteOrganization(deps: MembershipDeps, event: H3Event, orgId: string) {
  return revoke(
    deps,
    'delete',
    { organizationId: orgId },
    {
      remove: (tx) => tx.delete(orgMember).where(eq(orgMember.organizationId, orgId)).returning(),
      entry: {
        organizationId: orgId,
        action: 'organization.deleted',
        targetType: 'organization',
        targetId: orgId,
      },
    },
    event,
  )
}

// An invitation changes no role until it is accepted, so it writes no
// org_member row; it goes through studio so that every membership write has
// one path, and so that it is audited.
export async function inviteMember(
  deps: MembershipDeps,
  event: H3Event,
  actorRole: OrgRole,
  orgId: string,
  input: { email: string; role: OrgRole; resend?: boolean },
) {
  if (!canAssignRole(actorRole, input.role))
    forbidden('Requires a higher org role than the one given')
  return grant<{ id?: string }>(
    deps,
    'invite-member',
    {
      email: input.email,
      role: input.role,
      organizationId: orgId,
      ...(input.resend ? { resend: true } : {}),
    },
    async (_tx, invitation) => ({
      organizationId: orgId,
      action: 'member.invited',
      targetType: 'invitation',
      targetId: invitation?.id,
      targetLabel: input.email,
      after: { role: input.role },
    }),
    event,
  )
}

const MIN_CREDENTIAL_BYTES = 32

/**
 * The org-write target from the environment, or 503 `org_write_unconfigured`
 * before anything is written or asked. Names what is missing, never a value.
 */
export function orgWriteTarget(env: NodeJS.ProcessEnv = process.env): OrgWriteTarget {
  const base = env.AUTH_INTERNAL_URL
  const credential = env.ORG_WRITE_SERVICE_SECRET
  const missing = [
    ...(base ? [] : ['AUTH_INTERNAL_URL']),
    ...(credential && Buffer.byteLength(credential) >= MIN_CREDENTIAL_BYTES
      ? []
      : [`ORG_WRITE_SERVICE_SECRET (unset or under ${MIN_CREDENTIAL_BYTES} bytes)`]),
  ]
  if (missing.length) {
    recordOrgWriteIncomplete('unconfigured')
    console.error('[org-membership] org writes are off; missing:', missing.join(', '))
    throw createError({
      statusCode: 503,
      statusMessage: 'Org membership changes are not configured on this server',
      data: { code: 'org_write_unconfigured' },
    })
  }
  return { base: base!, credential: credential! }
}

/** The production wiring: the real database, auth as the signed-in user. */
export async function membershipDeps(event: H3Event): Promise<MembershipDeps> {
  const target = orgWriteTarget()
  const [{ db }, { lookupOrgById }] = await Promise.all([import('../db'), import('./org-lookup')])
  return {
    db,
    auth: authCaller(event, target),
    members: async (orgId) => (await lookupOrgById(event, orgId))?.members ?? null,
  }
}
