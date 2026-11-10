import { and, eq } from 'drizzle-orm'
import { createError, getRequestHeader, type H3Event } from 'h3'
import type { Db } from '../db'
import { auditLog, orgMember } from '../db/schema'
import { auditRow, type AuditEventInput } from './audit'
import { canAssignRole, canManageMember } from './org-membership-input'
import { authBase } from './org-lookup'
import { ORG_ROLES, orgRoleHelpers, type OrgRole } from './project-access'

// Studio's writes of org membership. Every change of who holds which org role
// goes through here, so that org_member always follows it.
//
// TWO SYSTEMS, ONE TRANSACTION. Auth keeps its own member table: the active
// org and the JWT's tenant claim depend on it, and auth's hooks mirror it into
// the permissions service. So each change is written twice: to auth, through
// its organization API with the user's own session (auth still decides whether
// the actor may do it), and to org_member, inside one studio transaction
// together with the audit row. Postgres and auth share no transaction, so the
// ORDER is chosen so that no failure leaves studio allowing what auth took away:
//
//   grant    (create org, accept invitation, a role change that only adds
//            rights): auth is called inside the open transaction, and studio
//            commits only after auth said yes. Auth refuses or fails: rollback,
//            nothing changed. Auth said yes and the commit fails: auth has the
//            member, studio does not, so studio denies (fail-closed).
//
//   revoke   (delete org, remove member, leave, a role change that takes any
//            right away): studio writes the lower state first, then calls auth
//            inside the same transaction. Auth refuses (4xx): rollback, nothing
//            changed. Auth's answer is unknown (network, 5xx): studio COMMITS
//            the lower state anyway, and for a role change it removes the row
//            entirely, because the new role may hold a right auth never gave.
//            The route answers 502 `auth_pending`. Auth said yes and the commit
//            fails: the removal is retried once outside the transaction; if that
//            fails too, the route answers 500 `org_member_stale` and the row is
//            left behind. That last case is the only one that fails OPEN, and
//            only while Postgres refuses two writes in a row.
//
// What is left behind after a failure is found by comparing auth's members
// with org_member. Nothing in this module repairs it.

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

/** Calls auth as the signed-in user: the request's own cookie and origin. */
export function authCaller(event: H3Event): AuthCall {
  const cookie = getRequestHeader(event, 'cookie')
  const origin = getRequestHeader(event, 'origin')
  return async (path, body) => {
    try {
      return await $fetch(`${authBase()}/api/auth/organization/${path}`, {
        method: 'POST',
        body,
        timeout: AUTH_TIMEOUT_MS,
        headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
      })
    } catch (err) {
      const e = err as { status?: number; statusCode?: number; data?: unknown; message?: string }
      const status = e?.status ?? e?.statusCode
      if (status && status >= 400 && status < 500) throw new AuthRefused(status, e.data)
      throw new AuthOutcomeUnknown(e?.message ?? String(err))
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
  return deps.db.transaction(async (tx) => {
    let answer: T
    try {
      answer = (await deps.auth(path, body)) as T
    } catch (err) {
      authError(err)
    }
    const entry = await write(tx, answer)
    await audit(tx, auditRow(event, entry))
    return answer
  })
}

async function revoke<T>(
  deps: MembershipDeps,
  path: string,
  body: Record<string, unknown>,
  lower: (exec: Exec) => Promise<void>,
  closeAll: (exec: Exec) => Promise<void>,
  entry: AuditEventInput,
  event: H3Event | null,
): Promise<T> {
  const audit = deps.audit ?? insertAudit
  let authSaidYes = false
  let pending = false
  let answer: T | undefined
  try {
    await deps.db.transaction(async (tx) => {
      await lower(tx)
      try {
        answer = (await deps.auth(path, body)) as T
        authSaidYes = true
      } catch (err) {
        if (!(err instanceof AuthOutcomeUnknown)) throw err
        pending = true
        await closeAll(tx)
      }
      await audit(tx, auditRow(event, pending ? { ...entry, after: { authPending: true } } : entry))
    })
  } catch (err) {
    if (authSaidYes) {
      // Auth removed it and studio's commit did not land: the one way this can
      // fail open. Retry the removal on its own; report loudly if that fails.
      try {
        await closeAll(deps.db)
      } catch (retryErr) {
        console.error('[org-membership] org_member left behind after', path, retryErr)
        throw createError({
          statusCode: 500,
          statusMessage: 'Changed in auth; studio could not record it',
          data: { code: 'org_member_stale' },
        })
      }
      return answer as T
    }
    authError(err)
  }
  if (pending) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Removed in studio; auth did not confirm it',
      data: { code: 'auth_pending' },
    })
  }
  return answer as T
}

const rowOf = (orgId: string, userId: string) =>
  and(eq(orgMember.organizationId, orgId), eq(orgMember.userId, userId))

const deleteRow = (orgId: string, userId: string) => async (exec: Exec) => {
  await exec.delete(orgMember).where(rowOf(orgId, userId))
}

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
  return revoke(deps, 'update-member-role', body, setRole, deleteRow(orgId, m.userId), entry, event)
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
  const remove = deleteRow(orgId, m.userId)
  return revoke(
    deps,
    'remove-member',
    { memberIdOrEmail: memberId, organizationId: orgId },
    remove,
    remove,
    {
      organizationId: orgId,
      action: 'member.removed',
      targetType: 'member',
      targetId: m.userId,
      before: { role: m.role },
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
  const remove = deleteRow(orgId, actorId)
  return revoke(
    deps,
    'leave',
    { organizationId: orgId },
    remove,
    remove,
    { organizationId: orgId, action: 'member.left', targetType: 'member', targetId: actorId },
    event,
  )
}

export async function deleteOrganization(deps: MembershipDeps, event: H3Event, orgId: string) {
  const removeAll = async (exec: Exec) => {
    await exec.delete(orgMember).where(eq(orgMember.organizationId, orgId))
  }
  return revoke(
    deps,
    'delete',
    { organizationId: orgId },
    removeAll,
    removeAll,
    {
      organizationId: orgId,
      action: 'organization.deleted',
      targetType: 'organization',
      targetId: orgId,
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

/** The production wiring: the real database, auth as the signed-in user. */
export async function membershipDeps(event: H3Event): Promise<MembershipDeps> {
  const [{ db }, { lookupOrgById }] = await Promise.all([import('../db'), import('./org-lookup')])
  return {
    db,
    auth: authCaller(event),
    members: async (orgId) => (await lookupOrgById(event, orgId))?.members ?? null,
  }
}
