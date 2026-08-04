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
// Dataminimering håndteres i stedet ved at pseudonymisere e-mailen ved
// SKRIVNING (salt_v1:<hash>, jura §16) — ikke ved at redigere rækken senere.
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
