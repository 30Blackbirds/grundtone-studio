import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3'
import { z } from 'zod'
import { db } from '~~/server/db'
import {
  activeVersion,
  apiKey,
  configVersion,
  projectInvitation,
  projectMember,
} from '~~/server/db/schema'

const REDACTED_EMAIL = 'deleted@redacted'

// ⚠️ TILFØJ IKKE font_licence_attestation HER — heller ikke "for konsistens".
//
// [jura] 2026-08-04 (§16): bevisregistret for font-licens-erklæringer er
// undtaget efter art. 17(3), og dets levetid hører til FILENS leverance +
// forældelsesfristen — ikke til brugerens konto. Modparten er en tredjepart
// (skriftproducenten), og krænkelsen er vedvarende så længe vi serverer
// filen: "en attestation for en font, vi stadig serverer, skal ikke udløbe,
// fordi den medarbejder der uploadede den, har forladt virksomheden."
//
// Dataminimering håndteres i stedet ved TIDSBEGRÆNSNING, ikke ved redaktion:
// rækken bærer klartekst-e-mail som bevis og slettes HELT når
// servingEndedAt + ATTESTATION_RETENTION_YEARS er passeret (jura §16a).
//
// E-mailen står bevidst i klartekst — jura omgjorde et tidligere hash-krav
// (§16 rev.): en hash kan bekræfte en formodning, men ikke FREMVISE en
// identitet, og efter en art. 17-sletning er userId heller ikke opløseligt.
// Hash + uopløseligt id ville give en række der peger på en identitet ingen
// kan slå op — vi ville have bevaret rækken for bevisværdiens skyld og
// samtidig fjernet netop den. Genopfind ikke den diskussion her.
//
// deleted.post.test.ts pinner at denne webhook lader tabellen være.

const bodySchema = z.object({
  userId: z.string().min(1),
})

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

defineRouteMeta({
  openAPI: {
    summary: 'Webhook from central auth after user deletion — scrubs Studio rows.',
    description:
      'Called by the central auth service after a user account is deleted. Removes project memberships and redacts denormalized email fields. Authenticated via ACCOUNT_DELETED_WEBHOOK_SECRET.',
    tags: ['Account'],
  },
})

export default defineEventHandler(async (event) => {
  const secret = process.env.ACCOUNT_DELETED_WEBHOOK_SECRET
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Webhook not configured' })
  }

  const authHeader = getRequestHeader(event, 'authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!token || !safeEqual(token, secret)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const raw = await readBody(event)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  const { userId } = parsed.data

  await db.delete(projectMember).where(eq(projectMember.userId, userId))

  await db
    .update(apiKey)
    .set({ createdByEmail: REDACTED_EMAIL })
    .where(eq(apiKey.createdBy, userId))

  await db
    .update(configVersion)
    .set({ publishedByEmail: REDACTED_EMAIL })
    .where(eq(configVersion.publishedBy, userId))

  await db
    .update(activeVersion)
    .set({ activatedByEmail: REDACTED_EMAIL })
    .where(eq(activeVersion.activatedBy, userId))

  await db
    .update(projectInvitation)
    .set({ invitedByEmail: REDACTED_EMAIL })
    .where(eq(projectInvitation.invitedBy, userId))

  return { ok: true, userId }
})
