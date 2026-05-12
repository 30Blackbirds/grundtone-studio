import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { projectInvitation } from '~~/server/db/schema'
import { PROJECT_ROLES, requireProjectAccess } from '~~/server/lib/project-access'
import { email } from '~~/server/lib/email'
import { localeFromEvent, projectInviteEmail } from '~~/server/lib/email-templates'

const INVITE_TTL_DAYS = 7

const bodySchema = z.object({
  email: z.email().max(200),
  role: z.enum(PROJECT_ROLES),
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'admin')

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  // Idempotency: if a pending invite for the same email already exists,
  // refresh its role + expiry instead of creating a duplicate.
  const [existing] = await db
    .select()
    .from(projectInvitation)
    .where(
      and(
        eq(projectInvitation.projectId, projectId),
        eq(projectInvitation.email, parsed.data.email),
        eq(projectInvitation.status, 'pending'),
      ),
    )

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const [row] = existing
    ? await db
        .update(projectInvitation)
        .set({ role: parsed.data.role, expiresAt })
        .where(eq(projectInvitation.id, existing.id))
        .returning()
    : await db
        .insert(projectInvitation)
        .values({
          projectId,
          email: parsed.data.email,
          role: parsed.data.role,
          status: 'pending',
          invitedBy: access.userId,
          expiresAt,
        })
        .returning()

  const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  const acceptUrl = `${baseUrl}/invitations/project/${row.id}`

  await email.send({
    to: parsed.data.email,
    ...projectInviteEmail(
      {
        acceptUrl,
        projectName: access.project.name,
        orgName: access.organization.name,
        role: parsed.data.role,
        expiresInDays: INVITE_TTL_DAYS,
      },
      localeFromEvent(event),
    ),
  })

  return row
})
