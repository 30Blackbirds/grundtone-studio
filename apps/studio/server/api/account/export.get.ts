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

defineRouteMeta({
  openAPI: {
    summary: 'GDPR data export for the authenticated user (JSON download).',
    description:
      'Aggregates Studio data belonging to the authenticated user and returns it as a JSON attachment. Rate-limited to one export per hour per user.',
    tags: ['Account'],
  },
})

export default defineEventHandler(async (event) => {
  const actor = event.context.auth
  if (!actor?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const limit = exportLimiter.check(`account-export:${actor.sub}`, 1)
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

  const payload = {
    exportedAt: new Date().toISOString(),
    userId,
    email: actor.email ?? null,
    projectMemberships: memberships,
    apiKeysCreated: keys,
    publishedVersions,
    activations,
    auditLogEntries: auditEntries,
    projectInvitationsSent: invitations,
  }

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="grundtone-studio-export-${Date.now()}.json"`,
  )

  return payload
})
