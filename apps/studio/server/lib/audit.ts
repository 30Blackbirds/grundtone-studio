import { getRequestHeader, getRequestIP, type H3Event } from 'h3'
import { db } from '../db'
import { auditLog } from '../db/schema'
import { auth } from './auth'

// Canonical action names. Add new ones at the bottom — these strings appear
// in the database forever, so renames require a data migration.
export type AuditAction =
  | 'member.invited'
  | 'member.invite_cancelled'
  | 'member.invite_accepted'
  | 'member.added'
  | 'member.removed'
  | 'member.role_changed'
  | 'project.created'
  | 'project.member.added'
  | 'project.member.removed'
  | 'project.member.role_changed'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'config.published'
  | 'config.activated'
  | 'organization.updated'

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'member.invited',
  'member.invite_cancelled',
  'member.invite_accepted',
  'member.added',
  'member.removed',
  'member.role_changed',
  'project.created',
  'project.member.added',
  'project.member.removed',
  'project.member.role_changed',
  'api_key.created',
  'api_key.revoked',
  'config.published',
  'config.activated',
  'organization.updated',
]

export interface AuditEventInput {
  organizationId: string
  action: AuditAction
  targetType?: string
  targetId?: string
  // Denormalized label captured at write-time (project name, member email,
  // api-key prefix). Survives the target being renamed or deleted.
  targetLabel?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  // Override the actor when the call isn't tied to an H3 event (background
  // jobs, Better Auth hooks). Leave undefined to derive from the session.
  actorUserId?: string
  actorEmail?: string
  ipAddress?: string
  userAgent?: string
}

/**
 * Append a row to audit_log. Fire-and-forget — never throws; logs and swallows
 * any error so a failing audit write can't break the underlying mutation.
 *
 * Pass `event` so IP + user-agent + session-derived actor are captured
 * automatically. For Better Auth hooks (no event handle), pass the explicit
 * `actorUserId` / `actorEmail` fields instead.
 */
export async function recordAuditEvent(
  event: H3Event | null,
  input: AuditEventInput,
): Promise<void> {
  try {
    let actorUserId = input.actorUserId ?? null
    let actorEmail = input.actorEmail ?? null
    let ipAddress = input.ipAddress ?? null
    let userAgent = input.userAgent ?? null

    if (event) {
      if (!actorUserId || !actorEmail) {
        const session = await auth.api.getSession({ headers: event.headers }).catch(() => null)
        if (session?.user) {
          actorUserId ??= session.user.id
          actorEmail ??= session.user.email
        }
      }
      ipAddress ??= getRequestIP(event, { xForwardedFor: true }) ?? null
      userAgent ??= getRequestHeader(event, 'user-agent') ?? null
    }

    await db.insert(auditLog).values({
      organizationId: input.organizationId,
      actorUserId,
      actorEmail,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ipAddress,
      userAgent,
    })
  } catch (err) {
    console.error('[audit] failed to record event', input.action, err)
  }
}
