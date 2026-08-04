import { createError, defineEventHandler, getQuery, getRouterParam, readRawBody } from 'h3'
import { z } from 'zod'
import { fontFileName, validateFontUpload } from '~~/server/lib/asset-upload'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { paths, putObject } from '~~/server/lib/storage'
import { FONT_WEIGHTS } from '~~/server/lib/tokens'

// Custom-font-upload til draft-laget: én .woff2 = én vægt (schemaets
// files-form er singular by design; flere vægte = flere kald, maks. 4 —
// grænsen håndhæves af tokens-schemaet når klienten gemmer referencerne).
// family+weight kommer som query (binær body er reserveret til selve filen).

const querySchema = z.object({
  slot: z.enum(['heading', 'body']),
  family: z.string().min(1).max(100),
  weight: z.coerce
    .number()
    .refine((w): w is (typeof FONT_WEIGHTS)[number] =>
      (FONT_WEIGHTS as readonly number[]).includes(w),
    ),
})

defineRouteMeta({
  openAPI: {
    summary:
      'Uploader én custom .woff2 (maks. 512KB) for én vægt til projektets draft-lag; kræver editor.',
    tags: ['Assets'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  await requireProjectAccess(event, projectId, 'editor')

  const query = querySchema.safeParse(getQuery(event))
  if (!query.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'slot (heading|body), family and weight (400-800) required',
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
  await putObject(paths(projectId).draftAsset(file), validated.body, {
    contentType: validated.contentType,
    cacheControl: 'no-store',
  })

  return { file, weight: query.data.weight }
})
