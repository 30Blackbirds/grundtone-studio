import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { saveDraft } from '~~/server/lib/save-draft'
import { tokensSchema } from '~~/server/lib/tokens'

defineRouteMeta({
  openAPI: {
    summary: 'Gemmer tokens som draft-version (upsert af eksisterende draft); kræver editor.',
    description:
      "Gemmer tokens som draft config-version og upsert'er en eksisterende draft, hvis der findes en. Kræver editor.",
    tags: ['Config'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'editor')

  const parsed = tokensSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  // The draft path itself lives in server/lib/save-draft.ts, shared with the
  // DTCG import so both doors mean the same thing by "saved as draft".
  return await saveDraft(event, access, projectId, parsed.data)
})
