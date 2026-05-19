import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3'
import { db } from '~~/server/db'
import { emailEvent } from '~~/server/db/schema'

// Postmark webhook receiver. Postmark POSTs JSON for each delivery / bounce /
// spam-complaint / open / click event, authenticated via Basic Auth on the
// URL (configured under Server Settings → Webhooks → Add Webhook). We
// validate Basic Auth, persist the event, and respond 200 — Postmark
// disables webhooks that return non-200 for 24h.
//
// Auth model — Basic Auth over HMAC:
//   Postmark's webhook delivery doesn't ship a signing key by default. The
//   documented "lock it down" path is Basic Auth on the URL, which the
//   receiver verifies against its own secret. Pragmatic and matches what
//   Postmark's dashboard offers.

interface PostmarkEvent {
  RecordType?: string
  MessageID?: string
  Recipient?: string
  Email?: string
  Type?: string
  Description?: string
  [key: string]: unknown
}

function parseBasicAuth(header: string | null | undefined): { user: string; pass: string } | null {
  if (!header || !header.startsWith('Basic ')) return null
  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8')
    const colonIdx = decoded.indexOf(':')
    if (colonIdx < 0) return null
    return { user: decoded.slice(0, colonIdx), pass: decoded.slice(colonIdx + 1) }
  } catch {
    return null
  }
}

// Constant-time string compare to avoid leaking timing info on the secret.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export default defineEventHandler(async (event) => {
  const expectedUser = process.env.POSTMARK_WEBHOOK_USER
  const expectedPass = process.env.POSTMARK_WEBHOOK_PASS
  if (!expectedUser || !expectedPass) {
    // Misconfiguration is a 500 (not a 401) — Postmark will retry and surface
    // it in their dashboard so we notice. Returning 401 would silently work
    // forever against an empty-secret production.
    throw createError({
      statusCode: 500,
      statusMessage: 'Webhook secrets not configured',
    })
  }

  const creds = parseBasicAuth(getRequestHeader(event, 'authorization'))
  if (!creds || !safeEqual(creds.user, expectedUser) || !safeEqual(creds.pass, expectedPass)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const payload = (await readBody<PostmarkEvent>(event)) ?? {}
  const recipient = payload.Recipient ?? payload.Email ?? ''
  if (!recipient) {
    throw createError({ statusCode: 400, statusMessage: 'Missing Recipient/Email' })
  }

  await db.insert(emailEvent).values({
    messageId: payload.MessageID ?? null,
    recipient,
    eventType: payload.RecordType ?? 'Unknown',
    bounceType: payload.Type ?? null,
    description: payload.Description ?? null,
    payload: payload as Record<string, unknown>,
  })

  return { ok: true }
})
