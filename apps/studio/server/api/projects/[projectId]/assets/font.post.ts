import { createError, defineEventHandler, getQuery, getRouterParam, readRawBody } from 'h3'
import { z } from 'zod'
import { db } from '~~/server/db'
import { fontLicenceAttestation } from '~~/server/db/schema'
import { FONT_LICENCE_VERSION } from '~~/lib/legal'
import { fontFileName, validateFontUpload } from '~~/server/lib/asset-upload'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { paths, putObject } from '~~/server/lib/storage'
import { FONT_WEIGHTS } from '~~/server/lib/tokens'

// Custom-font-upload til draft-laget: én .woff2 = én vægt (schemaets
// files-form er singular by design; flere vægte = flere kald, maks. 4 —
// grænsen håndhæves af tokens-schemaet når klienten gemmer referencerne).
// family+weight kommer som query (binær body er reserveret til selve filen).
//
// LICENS-ERKLÆRINGEN ER EN HÅRD FORUDSÆTNING (jura-ruling 2026-08-04):
// kunden indestår for at have ret til at lade os VIDEREDISTRIBUERE fonten til
// deres slutbrugere. Uden erklæring: 400 — checkboxens disabled-state i UI'et
// er bekvemmelighed, ikke gaten. Erklæringen persisteres FØR filen skrives, så
// vi aldrig kan komme til at ligge inde med en fil uden dokumentation, og den
// genafgives pr. fil (den knytter sig til den enkelte skrifttypes licens).

const querySchema = z.object({
  slot: z.enum(['heading', 'body']),
  family: z.string().min(1).max(100),
  weight: z.coerce
    .number()
    .refine((w): w is (typeof FONT_WEIGHTS)[number] =>
      (FONT_WEIGHTS as readonly number[]).includes(w),
    ),
  // Samme acceptProof-form som checkout (§8c): version gemmes ORDRET som
  // klienten sendte den, aldrig udledt server-side — ellers dokumenterer vi
  // vores egen antagelse i stedet for hvad brugeren faktisk fik forelagt.
  licenceVersion: z.string().min(1).max(100),
  licenceAcceptedAt: z.string().datetime({ offset: true }),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Uploader én custom .woff2 (maks. 512KB) for én vægt til projektets draft-lag; kræver editor + licens-erklæring.',
    tags: ['Assets'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'editor')

  const query = querySchema.safeParse(getQuery(event))
  if (!query.success) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'slot (heading|body), family, weight (400-800) and the font licence attestation (licenceVersion + licenceAcceptedAt) are required',
      data: { code: 'licence_attestation_required' },
    })
  }

  // Afvis en erklæring der ikke svarer til den tekst vi faktisk viser: en
  // ukendt version betyder at klienten er ude af sync med fladen, og så ved
  // vi ikke hvad brugeren har set — værre end ingen erklæring.
  if (query.data.licenceVersion !== FONT_LICENCE_VERSION) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown font licence version (expected ${FONT_LICENCE_VERSION})`,
      data: { code: 'licence_version_mismatch' },
    })
  }

  const raw = await readRawBody(event, false)
  if (!raw || raw.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Empty body' })
  }

  const validated = validateFontUpload(Buffer.isBuffer(raw) ? raw : Buffer.from(raw))
  if (!validated.ok) {
    throw createError({
      statusCode: 400,
      statusMessage:
        validated.error === 'too_large' ? 'File too large' : 'Only .woff2 is supported',
      data: { code: validated.error },
    })
  }

  const file = fontFileName(query.data.family, query.data.weight, query.data.slot)

  // Bevis FØR fil: fejler skrivningen bagefter, står vi med en erklæring uden
  // fil (harmløst) frem for en fil uden erklæring (præcis det jura forbyder).
  await db.insert(fontLicenceAttestation).values({
    projectId,
    organizationId: access.organization.id,
    slot: query.data.slot,
    file,
    weight: query.data.weight,
    family: query.data.family,
    version: query.data.licenceVersion,
    acceptedAt: new Date(query.data.licenceAcceptedAt),
    userId: access.userId,
    userEmail: event.context.auth?.email ?? null,
  })

  await putObject(paths(projectId).draftAsset(file), validated.body, {
    contentType: validated.contentType,
    cacheControl: 'no-store',
  })

  return { file, weight: query.data.weight }
})
