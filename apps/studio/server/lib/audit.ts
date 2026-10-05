import { getRequestHeader, getRequestIP, type H3Event } from 'h3'
import { db } from '../db'
import { auditLog } from '../db/schema'
import { recordAuditWriteFailed } from './metrics'

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
  | 'provisioning_key.created'
  | 'provisioning_key.revoked'
  | 'api_key.revoked'
  | 'config.published'
  | 'config.activated'
  | 'organization.updated'
  | 'config.draft_saved'
  | 'project.member.invited'
  | 'project.member.invite_cancelled'
  | 'project.member.invite_declined'
  | 'asset.font_uploaded'
  | 'asset.logo_uploaded'
  | 'audit.exported'

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
  'provisioning_key.created',
  'provisioning_key.revoked',
  'api_key.revoked',
  'config.published',
  'config.activated',
  'organization.updated',
  'config.draft_saved',
  'project.member.invited',
  'project.member.invite_cancelled',
  'project.member.invite_declined',
  'asset.font_uploaded',
  'asset.logo_uploaded',
  'audit.exported',
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
        // Identity now comes from the JWT-derived actor on event.context.auth,
        // populated by server/middleware/auth.ts. No DB/session round-trip.
        const actor = event.context.auth
        if (actor) {
          actorUserId ??= actor.sub
          actorEmail ??= actor.email ?? null
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
    // 🔴 STILL SWALLOWED, AND NOW COUNTED. Swallowing is deliberate: a failed
    // audit insert must not break the publish that caused it. But a failure
    // that only reaches console.error is a gap in the log that nobody learns
    // about, and "is the audit log complete?" then has no answer. The counter
    // makes the gap a number; whether a failed audit should instead FAIL the
    // request is a decision about 18 call sites, not something to change here.
    console.error('[audit] failed to record event', input.action, err)
    recordAuditWriteFailed(input.action)
  }
}
