import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, setHeader } from 'h3'
import { db } from '~~/server/db'
import {
  activeVersion,
  apiKey,
  auditLog,
  configVersion,
  project,
  projectInvitation,
  projectMember,
} from '~~/server/db/schema'
import { SlidingWindowRateLimiter } from '~~/server/lib/rate-limit'

const EXPORT_WINDOW_MS = 60 * 60 * 1000
const exportLimiter = new SlidingWindowRateLimiter(EXPORT_WINDOW_MS)

// Auth's art.20 identity-export contract (owned by @klanghaus/auth, PR #103).
// Secrets are deliberately excluded upstream (password hash, JWKS, oauth /
// session tokens) — we never receive them.
interface IdentityExport {
  user: Record<string, unknown>
  accounts: unknown[]
  organizations: unknown[]
  sessions: unknown[]
}

// Soft-fail marker returned in place of the identity block when auth can't be
// reached (endpoint 404 until IDENTITY_EXPORT_SERVICE_SECRET is provisioned,
// or a transient s2s error). art.20 must never be blocked by an auth outage —
// the caller refunds the rate-limit slot so the user can retry for a complete
// export.
interface IdentityUnavailable {
  error: 'identity_temporarily_unavailable'
  retryable: true
  message: string
}

async function fetchIdentityExport(userId: string): Promise<IdentityExport | IdentityUnavailable> {
  const base = process.env.AUTH_INTERNAL_URL ?? process.env.AUTH_ISSUER
  const secret = process.env.IDENTITY_EXPORT_SERVICE_SECRET
  const unavailable: IdentityUnavailable = {
    error: 'identity_temporarily_unavailable',
    retryable: true,
    message:
      'Din identitetsdata (konto, organisationer, sessioner) kunne ikke hentes lige nu. Din eksport er ellers komplet — prøv igen for at få identitetsdelen med.',
  }
  if (!base || !secret) return unavailable
  try {
    return await $fetch<IdentityExport>(`${base}/api/auth/identity-export`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: { userId },
    })
  } catch {
    return unavailable
  }
}

defineRouteMeta({
  openAPI: {
    summary: 'GDPR (art. 20) data export for the authenticated user (JSON download).',
    description:
      "Aggregates the authenticated user's Studio data and joins their identity data from the central auth service, returned as a JSON attachment. Rate-limited to one complete export per hour per user; an incomplete export (auth unreachable) does not consume the limit so it stays retryable.",
    tags: ['Account'],
  },
})

export default defineEventHandler(async (event) => {
  const actor = event.context.auth
  if (!actor?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const rateLimitKey = `account-export:${actor.sub}`
  const limit = exportLimiter.check(rateLimitKey, 1)
  if (!limit.ok) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Export rate limit exceeded — try again later',
    })
  }

  const userId = actor.sub

  const memberships = await db
    .select({
      projectId: projectMember.projectId,
      projectName: project.name,
      projectSlug: project.slug,
      organizationId: project.organizationId,
      role: projectMember.role,
      memberEmail: projectMember.memberEmail,
      memberName: projectMember.memberName,
      createdAt: projectMember.createdAt,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(eq(projectMember.userId, userId))

  const keys = await db
    .select({
      id: apiKey.id,
      projectId: apiKey.projectId,
      keyPrefix: apiKey.keyPrefix,
      keyType: apiKey.keyType,
      environment: apiKey.environment,
      rateLimit: apiKey.rateLimit,
      createdAt: apiKey.createdAt,
      revokedAt: apiKey.revokedAt,
    })
    .from(apiKey)
    .where(eq(apiKey.createdBy, userId))

  const publishedVersions = await db
    .select({
      id: configVersion.id,
      projectId: configVersion.projectId,
      version: configVersion.version,
      status: configVersion.status,
      publishedAt: configVersion.publishedAt,
    })
    .from(configVersion)
    .where(eq(configVersion.publishedBy, userId))

  const activations = await db
    .select({
      projectId: activeVersion.projectId,
      configVersionId: activeVersion.configVersionId,
      activatedAt: activeVersion.activatedAt,
    })
    .from(activeVersion)
    .where(eq(activeVersion.activatedBy, userId))

  const auditEntries = await db
    .select({
      id: auditLog.id,
      organizationId: auditLog.organizationId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      targetLabel: auditLog.targetLabel,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.actorUserId, userId))

  const invitations = await db
    .select({
      id: projectInvitation.id,
      projectId: projectInvitation.projectId,
      email: projectInvitation.email,
      role: projectInvitation.role,
      status: projectInvitation.status,
      createdAt: projectInvitation.createdAt,
    })
    .from(projectInvitation)
    .where(eq(projectInvitation.invitedBy, userId))

  const identity = await fetchIdentityExport(userId)

  // art.20 completeness > abuse-prevention: an export missing the identity
  // block isn't the complete portable copy the user is entitled to, so it must
  // not burn their once-per-hour slot. Refund it (limit is 1, so reset clears
  // exactly the slot we just took) whenever identity couldn't be joined.
  const identityComplete = !('error' in identity)
  if (!identityComplete) exportLimiter.reset(rateLimitKey)

  const payload = {
    exportedAt: new Date().toISOString(),
    userId,
    complete: identityComplete,
    studio: {
      email: actor.email ?? null,
      projectMemberships: memberships,
      apiKeysCreated: keys,
      publishedVersions,
      activations,
      auditLogEntries: auditEntries,
      projectInvitationsSent: invitations,
    },
    identity,
  }

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="grundtone-studio-export-${Date.now()}.json"`,
  )

  return payload
})
