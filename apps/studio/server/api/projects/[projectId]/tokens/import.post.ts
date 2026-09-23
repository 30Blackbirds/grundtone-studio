import { importTokens, type ImportReport, type StudioTokens } from '@grundtone-studio/dtcg'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { db } from '~~/server/db'
import { configVersion } from '~~/server/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { saveDraft } from '~~/server/lib/save-draft'
import { CURATED_FONT_WEIGHTS, tokensSchema, type Tokens } from '~~/server/lib/tokens'

// Import of a DTCG 2025.10 file as a DRAFT (riff KH-1044, I1–I4).
//
// Two steps on purpose: `dryRun` returns the mapping report and writes nothing,
// so the person sees what would happen — including what would be overwritten —
// before anything changes. A commit writes a draft by the SAME path as the
// editor (server/lib/save-draft.ts) and NEVER publishes.
//
// 🔴 tokensSchema is still the only validator. The dtcg package maps values and
// reports; what may be SAVED is decided here, by the app's own schema (O3). A
// mapped value that the schema rejects is a 400, not a silent drop.

// A token file is a document a person exported from a design tool; this is not
// an upload endpoint for arbitrary payloads. The cap is generous for tokens and
// small enough that a malicious body cannot become a memory problem.
const MAX_DOCUMENT_BYTES = 2_000_000

const importBody = z.object({
  /** The base file, parsed JSON — not a string. */
  base: z.unknown(),
  /** The dark file, if the person marked one as dark (I1). */
  dark: z.unknown().optional(),
  /** true → report only, nothing is written. */
  dryRun: z.boolean().default(false),
})

export interface ImportResponse {
  report: ImportReport
  /** The tokens that would be (or were) saved: the draft after the merge. */
  tokens: Tokens | StudioTokens
  /** Present only on a commit. */
  version?: number
  saved: boolean
}

defineRouteMeta({
  openAPI: {
    summary: 'Importerer en DTCG 2025.10-fil som udkast; kræver editor.',
    description:
      'To trin: dryRun=true returnerer mapping-rapporten uden at skrive, og et commit gemmer et draft ad samme vej som config.post. Publicerer aldrig.',
    tags: ['Config'],
  },
})

export default defineEventHandler(async (event): Promise<ImportResponse> => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'editor')

  const parsedBody = importBody.safeParse(await readBody(event))
  if (!parsedBody.success) {
    throw createError({ statusCode: 400, statusMessage: parsedBody.error.issues[0]?.message })
  }
  const { base, dark, dryRun } = parsedBody.data
  for (const [name, document] of [
    ['base', base],
    ['dark', dark],
  ] as const) {
    if (document !== undefined && JSON.stringify(document).length > MAX_DOCUMENT_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: `the ${name} document is larger than ${MAX_DOCUMENT_BYTES} bytes`,
      })
    }
  }

  const [draft] = await db
    .select()
    .from(configVersion)
    .where(and(eq(configVersion.projectId, projectId), eq(configVersion.status, 'draft')))
    .orderBy(desc(configVersion.createdAt))
    .limit(1)
  const current = (draft?.tokensJson ?? {}) as Tokens

  const result = importTokens(base, dark ?? null, {
    curatedFonts: CURATED_FONT_WEIGHTS,
    current,
  })

  // I4: slots in the file replace the draft's values; slots outside it are
  // untouched. The merge is per group, because a file that carries only colours
  // must not erase the spacing scale.
  const merged = mergeTokens(current, result.tokens)

  if (dryRun) {
    return { report: result.report, tokens: merged, saved: false }
  }

  if (result.report.parseErrors.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `the file has ${result.report.parseErrors.length} structural error(s); nothing was imported`,
    })
  }

  const validated = tokensSchema.safeParse(merged)
  if (!validated.success) {
    throw createError({
      statusCode: 400,
      statusMessage: `the imported tokens are not valid: ${validated.error.issues[0]?.message}`,
    })
  }

  const row = await saveDraft(event, access, projectId, validated.data, { source: 'dtcg-import' })
  return { report: result.report, tokens: validated.data, version: row.version, saved: true }
})

/** Group-wise merge: a group the file did not carry is left exactly as it was. */
export function mergeTokens(current: Tokens, incoming: StudioTokens): Tokens {
  const merged: Record<string, unknown> = { ...current }
  for (const group of ['colors', 'radius', 'spacing'] as const) {
    if (incoming[group]) merged[group] = { ...(current[group] ?? {}), ...incoming[group] }
  }
  if (incoming.dark?.colors) {
    merged.dark = {
      ...(current.dark ?? {}),
      colors: { ...(current.dark?.colors ?? {}), ...incoming.dark.colors },
    }
  }
  if (incoming.typography) {
    const typography: Record<string, unknown> = { ...(current.typography ?? {}) }
    if (incoming.typography.fontFamily) {
      typography.fontFamily = {
        ...(current.typography?.fontFamily ?? {}),
        ...incoming.typography.fontFamily,
      }
    }
    if (incoming.typography.slots) {
      typography.slots = { ...(current.typography?.slots ?? {}), ...incoming.typography.slots }
    }
    merged.typography = typography
  }
  return merged as Tokens
}
