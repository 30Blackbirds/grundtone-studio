import { and, eq } from 'drizzle-orm'
import { isIP } from 'node:net'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createError, getRequestHeader, type H3Event } from 'h3'
import type { Db } from '../db'
import * as schema from '../db/schema'
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
// CONCURRENCY: the claim above holds only because writes on one org's members
// run one at a time (withOrgLock); without that, a refused change could put
// back a row a concurrent removal had already taken away in auth.
//
// NOT COVERED: a change that reaches auth without going through studio (a call
// straight to auth, until auth refuses those, ClickUp 1amk32fna12). Studio
// never sees it, so only the comparison of auth's members with org_member does.
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
  /** The org an invitation belongs to, from auth; null when auth has no such invitation. */
  invitationOrg: (invitationId: string) => Promise<string | null>
  /** Auth's view of an org's members, to learn whom a member id names. */
  members: (orgId: string) => Promise<Array<{ id: string; userId: string; role: string }> | null>
  /** Overrides ORG_LOCK_LIMITS (tests). */
  lockLimits?: OrgLockLimits
  /** Wraps the locked connection's database (tests: to make one write fail). */
  onLocked?: (db: Db) => Db
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
function cookieOf(event: H3Event): Record<string, string> {
  const cookie = getRequestHeader(event, 'cookie')
  return cookie ? { cookie } : {}
}

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
  // Managing members follows the RANK rule the routes enforce
  // (org-membership-input.ts canManageMember): admin and above may manage the
  // ranks below them. That rule decides who may; this set only decides whether
  // a role change takes rights away, and must agree with it.
  if (role === 'owner' || role === 'manager' || role === 'admin') r.add('org:members')
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

/** How many org-membership writes this process runs at once, and how long one waits for its org. */
export interface OrgLockLimits {
  maxConcurrent: number
  waitMs: number
}

/**
 * Well below the database pool (postgres.js default max 10): each write holds
 * exactly one connection, so at most this many are ever taken by org writes,
 * and the rest of studio keeps its connections. Per process; studio runs one.
 */
export const ORG_LOCK_LIMITS: OrgLockLimits = { maxConcurrent: 4, waitMs: 5_000 }

let activeOrgWrites = 0

function busy(reason: string): never {
  recordOrgWriteIncomplete('busy')
  throw createError({
    statusCode: 503,
    statusMessage: `Org membership is busy (${reason}); try again`,
    data: { code: 'org_write_busy' },
  })
}

/**
 * 🔴 ONE MEMBERSHIP WRITE AT A TIME PER ORG, ON ONE CONNECTION.
 *
 * Why serialise (Sikkerhed C1 on #388): two writes on the same member could
 * interleave across the auth call. A demotion auth will refuse removes the row
 * and waits; a removal meanwhile gets auth's yes; then the refused demotion
 * puts the row BACK, and studio holds a role auth no longer has.
 *
 * Why this shape (Sikkerhed C2): a transaction-scoped lock held beside the
 * operation's own transactions took two pooled connections per write, and a
 * waiter held one too; ten concurrent writes emptied the pool and every query
 * in studio hung. So:
 *   - one RESERVED connection per write holds a SESSION advisory lock, and
 *     every transaction of the operation runs on that same connection (`run`
 *     gets it as its database);
 *   - the wait for the lock is bounded (`waitMs`, polling try-lock), then 503
 *     `org_write_busy`;
 *   - at most `maxConcurrent` writes at once in this process; one more gets
 *     503 `org_write_busy` at once, before it takes any connection.
 */
export async function withOrgLockOn<T>(
  db: Db,
  orgId: string,
  run: (locked: Db) => Promise<T>,
  limits: OrgLockLimits = ORG_LOCK_LIMITS,
): Promise<T> {
  if (activeOrgWrites >= limits.maxConcurrent) busy('too many writes at once')
  activeOrgWrites++
  let reserved: Awaited<ReturnType<Db['$client']['reserve']>> | undefined
  try {
    reserved = await db.$client.reserve()
    const key = `org_member:${orgId}`
    const deadline = Date.now() + limits.waitMs
    let pid = 0
    for (;;) {
      const [row] = await reserved<{ ok: boolean; pid: number }[]>`
        select pg_try_advisory_lock(hashtext(${key})) as ok, pg_backend_pid() as pid`
      pid = row?.pid ?? 0
      if (row?.ok) break
      if (Date.now() >= deadline) busy('another write on this organization')
      await new Promise((r) => setTimeout(r, 50))
    }
    try {
      // drizzle reads the client's parser options, which a reserved connection
      // does not carry; they are the pool's (already set up by server/db).
      const conn = Object.assign(reserved, { options: db.$client.options })
      const locked = drizzle(conn, { schema, casing: 'snake_case' }) as unknown as Db
      // A reserved connection has no begin(); it is ours alone, so a
      // transaction is BEGIN/COMMIT on it, and every one stays on it.
      const rc = reserved
      locked.transaction = (async (fn: (tx: unknown) => Promise<unknown>) => {
        await rc`begin`
        try {
          const out = await fn(locked)
          await rc`commit`
          return out
        } catch (err) {
          await rc`rollback`
          throw err
        }
      }) as Db['transaction']
      return await run(locked)
    } finally {
      // A session lock outlives the operation unless released, and the
      // connection goes back to the POOL, where it may live 30-60 minutes
      // (postgres.js max_lifetime). If the unlock does not say true, end that
      // backend instead (Postgres then drops its locks), so the org is not
      // left "busy" behind a pooled connection.
      let unlocked = false
      try {
        const [row] = await reserved<{ ok: boolean }[]>`
          select pg_advisory_unlock(hashtext(${key})) as ok`
        unlocked = row?.ok === true
      } catch {
        unlocked = false
      }
      if (!unlocked) {
        recordOrgWriteIncomplete('unlock_failed')
        console.error('[org-membership] advisory unlock failed; ending that connection')
        await db.$client`select pg_terminate_backend(${pid})`.catch(() => {})
      }
    }
  } finally {
    activeOrgWrites--
    reserved?.release()
  }
}

/** withOrgLockOn for the operations: `run` gets deps whose db is the locked connection. */
function withOrgLock<T>(
  deps: MembershipDeps,
  orgId: string,
  run: (deps: MembershipDeps) => Promise<T>,
): Promise<T> {
  return withOrgLockOn(
    deps.db,
    orgId,
    (db) => run({ ...deps, db: deps.onLocked ? deps.onLocked(db) : db }),
    deps.lockLimits,
  )
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
  // The org is known only from the invitation; read it first so the accept runs
  // under that org's lock like every other write on its members.
  let orgId: string | null
  try {
    orgId = await deps.invitationOrg(invitationId)
  } catch (err) {
    authError(err)
  }
  if (!orgId) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  return withOrgLock(deps, orgId, (deps) =>
    grant<Answer>(
      deps,
      'accept-invitation',
      { invitationId },
      async (tx, res) => {
        const m = res?.member
        // The role is the one auth recorded, never one from the request.
        if (
          !m?.organizationId ||
          m.organizationId !== orgId ||
          m.userId !== actorId ||
          !isOrgRole(m.role)
        ) {
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
    ),
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
  return withOrgLock(deps, orgId, async (deps) => {
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
  })
}

export async function removeMember(
  deps: MembershipDeps,
  event: H3Event,
  actorRole: OrgRole,
  orgId: string,
  memberId: string,
) {
  return withOrgLock(deps, orgId, async (deps) => {
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
  })
}

export async function leaveOrganization(
  deps: MembershipDeps,
  event: H3Event,
  actorId: string,
  orgId: string,
) {
  // Auth fires no hook on leave, so this route is the only thing that ends a
  // leaver's org role in studio. A caller who is not a member is refused
  // before any connection or lock is taken (Sikkerhed C2: leave has no role
  // check, so it must not let anyone hold the org's lock).
  const members = await deps.members(orgId)
  if (!members?.some((m) => m.userId === actorId)) {
    throw createError({ statusCode: 404, statusMessage: 'Not a member of this organization' })
  }
  return withOrgLock(deps, orgId, async (deps) => {
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
  })
}

export async function deleteOrganization(deps: MembershipDeps, event: H3Event, orgId: string) {
  return withOrgLock(deps, orgId, async (deps) => {
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
  })
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
 * M1 (Sikkerhed): the credential travels in a header that proxies, Sentry and
 * loggers do not redact the way they redact Authorization and Cookie, so in
 * production it may only go over https, or over plain http to loopback or a
 * private address given as an IP LITERAL.
 *
 * C3: a hostname is never trusted by its spelling. `10.evil.example` or
 * `127.attacker.example` are public names that merely start like a private
 * range, and a single-label name (`auth`) resolves through the resolver's
 * search domains and can land on a public host. Only `localhost` and IP
 * literals in loopback or private ranges pass over http.
 */
export function safeAuthTarget(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  if (u.protocol !== 'http:') return false
  const h = u.hostname.replace(/^\[|\]$/g, '')
  if (h === 'localhost') return true
  const v = isIP(h)
  if (v === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number]
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (v === 6) return h === '::1' || /^f[cd][0-9a-f]{2}:/i.test(h)
  return false
}

/**
 * The org-write target from the environment, or 503 `org_write_unconfigured`
 * before anything is written or asked. Names what is missing, never a value.
 */
export function orgWriteTarget(env: NodeJS.ProcessEnv = process.env): OrgWriteTarget {
  const base = env.AUTH_INTERNAL_URL
  const credential = env.ORG_WRITE_SERVICE_SECRET
  const missing = [
    ...(base ? [] : ['AUTH_INTERNAL_URL']),
    ...(base && env.NODE_ENV === 'production' && !safeAuthTarget(base)
      ? ['AUTH_INTERNAL_URL (in production: https, or http only to a private host)']
      : []),
    // Certificate checks off would let any host answer for auth and read the credential.
    ...(env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
      ? ['NODE_TLS_REJECT_UNAUTHORIZED=0 (must be unset)']
      : []),
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
    invitationOrg: async (invitationId) => {
      try {
        const inv = await $fetch<{ organizationId?: string } | null>(
          `${target.base}/api/auth/organization/get-invitation`,
          {
            query: { id: invitationId },
            timeout: AUTH_TIMEOUT_MS,
            headers: cookieOf(event),
          },
        )
        return inv?.organizationId ?? null
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status && status >= 400 && status < 500) return null
        throw new AuthOutcomeUnknown(status ? `auth answered ${status}` : 'auth did not answer')
      }
    },
    members: async (orgId) => (await lookupOrgById(event, orgId))?.members ?? null,
  }
}
