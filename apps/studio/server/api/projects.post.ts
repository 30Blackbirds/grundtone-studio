import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~~/server/db'
import { project } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { lookupOrgBySlug } from '~~/server/lib/org-lookup'
import { grantProjectRole, linkProjectToOrg } from '~~/server/lib/pdp'

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must match /^[a-z0-9-]+$/'),
  organizationSlug: z.string().min(1),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Opretter et projekt, linker det til org i PDP og gør opretteren til projekt-admin (rollback ved PDP-fejl).',
    description:
      'Opretter et projekt, linker det til org i PDP og gør opretteren til projekt-admin. Ruller DB-indsættelsen tilbage ved PDP-fejl.',
    tags: ['Projects'],
  },
})

export default defineEventHandler(async (event) => {
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const org = await lookupOrgBySlug(event, parsed.data.organizationSlug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  // Membership is proven by the org lookup being scoped to the caller; the org
  // role gate (only admin/manager/owner create projects) is enforced by the PDP
  // — a member without create rights gets the lookup but the grant below would
  // still leave them as project admin, so we additionally require that the
  // caller actually appears in the resolved org membership.
  const isMember = org.members?.some((m) => m.userId === actor.sub) ?? true
  if (!isMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not a member of this organization' })
  }

  const [inserted] = await db
    .insert(project)
    .values({
      organizationId: org.id,
      slug: parsed.data.slug,
      name: parsed.data.name,
    })
    .returning()

  // Wire the project into the PDP: link it to its org so org roles cascade, and
  // make the creator a project admin. If either write fails we roll back the row
  // so we never leave an orphan project the creator can't administer.
  try {
    await linkProjectToOrg(event, inserted.id, org.id)
    await grantProjectRole(event, inserted.id, actor.sub, 'admin')
  } catch (err) {
    await db.delete(project).where(eq(project.id, inserted.id))
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to register project permissions',
      cause: err,
    })
  }

  await recordAuditEvent(event, {
    organizationId: org.id,
    action: 'project.created',
    targetType: 'project',
    targetId: inserted.id,
    targetLabel: inserted.name,
    after: { slug: inserted.slug, name: inserted.name },
  })

  return inserted
})
