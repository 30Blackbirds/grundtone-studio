import { z } from 'zod'
import { db } from '~~/server/db'
import { project } from '~~/server/db/schema'
import { auth } from '~~/server/lib/auth'

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must match /^[a-z0-9-]+$/'),
  organizationSlug: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const org = await auth.api.getFullOrganization({
    headers: event.headers,
    query: { organizationSlug: parsed.data.organizationSlug },
  })
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  const member = org.members?.find((m) => m.userId === session.user.id)
  if (!member) throw createError({ statusCode: 403, statusMessage: 'Not a member of this organization' })

  const [inserted] = await db
    .insert(project)
    .values({
      organizationId: org.id,
      slug: parsed.data.slug,
      name: parsed.data.name,
    })
    .returning()

  return inserted
})
