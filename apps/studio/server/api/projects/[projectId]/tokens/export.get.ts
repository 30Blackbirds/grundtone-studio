import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { exportTokens, RESOLVER_MEDIA_TYPE, TOKENS_MEDIA_TYPE } from '@grundtone-studio/dtcg'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { loadTokenSource, type TokenSource } from '~~/server/lib/token-source'

defineRouteMeta({
  openAPI: {
    summary: 'Exports the draft or active token set as DTCG 2025.10 files.',
    description:
      'part=base|dark|resolver returns one file as an attachment; part=report returns what the ' +
      'export left out or converted, plus the file names. Needs project:viewer, like reading ' +
      'the config. Not gated by plan or subscription.',
    tags: ['Config'],
  },
})

const SOURCES: readonly TokenSource[] = ['draft', 'active']
const PARTS = ['base', 'dark', 'resolver', 'report'] as const
type Part = (typeof PARTS)[number]

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const query = getQuery(event)
  const source = query.source as TokenSource
  // No default on purpose: exporting the draft when the caller meant the
  // published set (or the reverse) would hand over the wrong tokens silently.
  if (!SOURCES.includes(source)) {
    throw createError({ statusCode: 400, statusMessage: 'source must be draft or active' })
  }
  const part = (query.part ?? 'base') as Part
  if (!PARTS.includes(part)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'part must be base, dark, resolver or report',
    })
  }

  const access = await requireProjectAccess(event, projectId)

  const loaded = await loadTokenSource(projectId, source)
  if (!loaded) {
    throw createError({
      statusCode: 404,
      statusMessage: `Project has no ${source} version`,
      data: { code: 'version_not_found' },
    })
  }

  const result = exportTokens(loaded.tokens, { name: access.project.slug })
  setHeader(event, 'Cache-Control', 'no-store')

  if (part === 'report') {
    return {
      source,
      version: loaded.version,
      files: {
        base: result.files.base.name,
        dark: result.files.dark?.name ?? null,
        resolver: result.files.resolver?.name ?? null,
      },
      report: result.report,
    }
  }

  const file = result.files[part]
  if (!file) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project has no dark colors, so there is no dark or resolver file',
      data: { code: 'no_dark_layer' },
    })
  }
  setHeader(event, 'Content-Type', part === 'resolver' ? RESOLVER_MEDIA_TYPE : TOKENS_MEDIA_TYPE)
  setHeader(event, 'Content-Disposition', `attachment; filename="${file.name}"`)
  return JSON.stringify(file.document, null, 2)
})
