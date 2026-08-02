import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~~/server/db'
import { orgSuspension } from '~~/server/db/schema'

// Portal-side of account's TenantLifecycleCallbackService (kontrakt §8a/§9,
// §9a-justeret): REST-formen er eksplicit INTERIM — slutmålet er den kanoniske
// Connect-service når @klanghaus/eventcontract er live; feltnavne holdes 1:1
// så swappet er mekanisk. reason/actor er audit-kæden fra den ratificerede
// proto og persisteres med suspensionen; workflowId i svaret er et syntetisk
// id der holder accounts klient-port identisk på tværs af transporterne.
//
// (kontrakt §8a/§9):
// account calls this on suspend/reactivate. cdnGraceUntil comes from ACCOUNT
// (single source for the ToS §10.2 grace — Allan-approved 14 days); Studio
// only enforces the stored timestamp in the /k CDN route.
//
// Auth: interim shared bearer (LIFECYCLE_S2S_TOKEN) — swaps to [auth]-minted
// S2S-JWT verification when their mint flow lands, same interim pattern as
// the outbound ACCOUNT_S2S_TOKEN. Without the env the endpoint is DORMANT
// (503), so it can ship before account's caller exists.

const bodySchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('suspended'),
    tenantOrgId: z.string().min(1),
    reason: z.string().min(1),
    actor: z.string().min(1),
    suspendedAt: z.string().datetime({ offset: true }),
    cdnGraceUntil: z.string().datetime({ offset: true }),
  }),
  z.object({
    state: z.literal('active'),
    tenantOrgId: z.string().min(1),
    reason: z.string().min(1),
    actor: z.string().min(1),
  }),
])

defineRouteMeta({
  openAPI: {
    summary: 'Lifecycle-callback fra account: suspend/reactivate af en tenant-org.',
    description:
      "S2S. suspended → gemmer suspension + cdnGraceUntil (accounts værdi = ToS §10.2-grace); /k-ruten 410'er efter grace-udløb. active → sletter rækken, delivery genoptages øjeblikkeligt. Idempotent.",
    tags: ['Lifecycle'],
  },
})

export default defineEventHandler(async (event) => {
  const expected = process.env.LIFECYCLE_S2S_TOKEN
  if (!expected) {
    throw createError({ statusCode: 503, statusMessage: 'Lifecycle callbacks not configured' })
  }
  const auth = getHeader(event, 'authorization')
  if (auth !== `Bearer ${expected}`) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  if (parsed.data.state === 'suspended') {
    const row = {
      suspendedAt: new Date(parsed.data.suspendedAt),
      cdnGraceUntil: new Date(parsed.data.cdnGraceUntil),
      reason: parsed.data.reason,
      actor: parsed.data.actor,
    }
    await db
      .insert(orgSuspension)
      .values({ organizationId: parsed.data.tenantOrgId, ...row })
      .onConflictDoUpdate({ target: orgSuspension.organizationId, set: row })
  } else {
    // The reactivation's audit trail lives with account (the caller); here the
    // row simply disappears — log so the local trace still shows who/why.
    console.info(
      `[lifecycle] reactivate ${parsed.data.tenantOrgId} (actor=${parsed.data.actor}, reason=${parsed.data.reason})`,
    )
    await db.delete(orgSuspension).where(eq(orgSuspension.organizationId, parsed.data.tenantOrgId))
  }

  return { accepted: true, workflowId: randomUUID() }
})
