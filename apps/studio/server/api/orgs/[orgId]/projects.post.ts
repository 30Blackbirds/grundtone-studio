import { and, eq, sql } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { db } from '~~/server/db'
import { project } from '~~/server/db/schema'
import { recordAuditEvent } from '~~/server/lib/audit'
import { grantMachineProjectRole, linkProjectToOrg } from '~~/server/lib/pdp'

// Create a project with a provisioning key (KH-964 AC-B).
//
// 🔴 THE IDEMPOTENCY IS THE DATABASE'S, NOT THIS HANDLER'S. AC-B3 requires that
// two CONCURRENT calls with the same externalRef leave exactly one project and
// that both callers get a success with the same id. A read-then-write here
// cannot promise that: both reads can miss before either writes. So the insert
// carries `ON CONFLICT DO NOTHING` against the partial unique index on
// (organization_id, external_ref), and a caller that loses the race re-reads
// the winner's row. The handler never decides who won.
//
// 🔴 AND THE KEY GETS editor, NOT admin, ON WHAT IT CREATES. AC-D4 requires
// that a machine never holds project.admin: admin carries member management and
// key administration, which AC-D2 refuses to provisioning keys. editor is what
// writing tokens and publishing needs, and nothing more.

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must match /^[a-z0-9-]+$/'),
  // Required here, unlike in the UI: a machine that cannot name its own
  // reference cannot retry safely, and a retry is the normal case for it.
  externalRef: z.string().min(1).max(200),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Opretter et projekt med en provisioning-nøgle; idempotent på externalRef. Kræver en prov_-nøgle for DENNE org.',
    description:
      'Opretter et projekt i nøglens organisation. Gentages kaldet med samme externalRef, returneres det eksisterende projekt (200) uden dublet og uden nyt created-audit-event. Et slug der allerede er i brug med et ANDET externalRef afvises med 409 og code=slug_taken.',
    tags: ['Org', 'Provisioning'],
  },
})

export default defineEventHandler(async (event) => {
  const orgId = getRouterParam(event, 'orgId')
  if (!orgId) throw createError({ statusCode: 400, statusMessage: 'orgId required' })

  const principal = event.context.provisioning
  if (!principal) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Provisioning key required',
      data: { code: 'provisioning_key_required' },
    })
  }

  // 🔴 LEAST PRIVILEGE IS CHECKED HERE, NOT ASSUMED FROM THE PATH (AC-D1). The
  // key carries its own organizationId; the path carries the caller's claim
  // about which org to act in. A mismatch is a 403, never a silent redirect to
  // the key's own org — answering the question that was not asked is how a
  // cross-tenant write looks reasonable in a log.
  if (principal.organizationId !== orgId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This provisioning key belongs to another organization',
      data: { code: 'wrong_organization' },
    })
  }

  const parsed = bodySchema.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message,
      data: { code: 'invalid_body' },
    })
  }
  const data = parsed.data

  let inserted: typeof project.$inferSelect | undefined
  try {
    const rows = await db
      .insert(project)
      .values({
        organizationId: orgId,
        slug: data.slug,
        name: data.name,
        externalRef: data.externalRef,
      })
      // 🔴 `targetWhere` IS REQUIRED, NOT DECORATION. The unique index is
      // PARTIAL (`WHERE external_ref IS NOT NULL`), and Postgres refuses an ON
      // CONFLICT target that does not carry the index's predicate:
      //   ERROR: there is no unique or exclusion constraint matching the ON
      //   CONFLICT specification
      // Measured — without it this insert throws on EVERY create, so the
      // endpoint would 500 on its happy path while typecheck stayed green.
      .onConflictDoNothing({
        target: [project.organizationId, project.externalRef],
        where: sql`${project.externalRef} IS NOT NULL`,
      })
      .returning()
    inserted = rows[0]
  } catch (err) {
    // The OTHER unique index — (organizationId, slug) — is a different answer:
    // the caller asked for a slug someone else already holds under a different
    // reference. AC-B4 wants that distinguishable from the idempotent case,
    // because the cure is different: pick another slug, not retry.
    if (isUniqueViolation(err)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'That slug is already used in this organization',
        data: { code: 'slug_taken' },
      })
    }
    throw err
  }

  if (!inserted) {
    // Lost the race, or a plain repeat. Either way the winner's row is the
    // answer, and no audit event is written: nothing was created (AC-B2).
    const [existing] = await db
      .select()
      .from(project)
      .where(and(eq(project.organizationId, orgId), eq(project.externalRef, data.externalRef)))
    if (!existing) {
      // The conflict fired but the row is not there — a state this code cannot
      // explain, so it says so rather than inventing a 200.
      throw createError({
        statusCode: 500,
        statusMessage: 'Project conflicted but could not be read back',
        data: { code: 'idempotency_readback_failed' },
      })
    }
    setResponseStatus(event, 200)
    return existing
  }

  // Wire the new project into the PDP, then roll the row back if that fails —
  // an orphan project no principal can act in is worse than no project.
  try {
    await linkProjectToOrg(event, inserted.id, orgId)
    await grantMachineProjectRole(event, inserted.id, principal.keyId, 'editor')
  } catch (err) {
    await db.delete(project).where(eq(project.id, inserted.id))
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to register project permissions',
      data: { code: 'pdp_write_failed' },
      cause: err,
    })
  }

  await recordAuditEvent(event, {
    organizationId: orgId,
    action: 'project.created',
    targetType: 'project',
    targetId: inserted.id,
    targetLabel: inserted.name,
    // The actor is the KEY, not a person — audit must be able to answer "who
    // created this?" with something that exists.
    after: { slug: inserted.slug, name: inserted.name, externalRef: inserted.externalRef },
  })

  setResponseStatus(event, 201)
  return inserted
})

/** Postgres unique-violation, whatever driver wrapper it arrives in. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
  return code === '23505' || (err as { cause?: { code?: string } })?.cause?.code === '23505'
}
