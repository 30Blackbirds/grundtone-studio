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

// 🔴 WHAT THIS BOUNDS, AND WHAT IT DOES NOT. Corrected after [sikkerhed]
// measured the earlier comment here and found it false three ways (#319).
//
// This limit is on the PARSED document, applied AFTER readBody. It does NOT
// bound what the process receives: by the time this runs, the body has been
// read and parsed. Nothing in this app bounds receipt today — studio's Caddy
// has no `request_body` limit (positive control: sonar's sets max_size), and
// config.post.ts has the same exposure. That is [sikkerhed]'s riff, not
// something this endpoint introduced or can close.
//
// It is also not a byte count: JSON.stringify().length counts UTF-16 units of
// the RE-serialized document, so a non-BMP body passes at ~3.6 MB of real
// bytes and a pretty-printed one at ~2.27 MB uploaded. It is kept as a coarse
// ceiling on obviously absurd documents, measured defensively because
// stringify itself throws on a deeply nested input.
//
// The bound that actually protects the parser is DEPTH, in packages/dtcg
// (MAX_DEPTH/MAX_NODES): a 30 KB document nested 5000 deep — 1.5 % of this
// ceiling — used to make parseDocument throw RangeError, i.e. a 500.
const MAX_SERIALIZED_UNITS = 2_000_000

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
    if (document === undefined) continue
    let units: number
    try {
      units = JSON.stringify(document)?.length ?? 0
    } catch {
      // stringify throws on a document too deep to serialize. That is itself a
      // refusal, not a 500: the parser would reject it for depth anyway.
      throw createError({
        statusCode: 413,
        statusMessage: `the ${name} document could not be measured; it is too large or too deeply nested`,
      })
    }
    if (units > MAX_SERIALIZED_UNITS) {
      throw createError({
        statusCode: 413,
        statusMessage: `the ${name} document is larger than ${MAX_SERIALIZED_UNITS} serialized units`,
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

  // 🔴 A FOREIGN DOCUMENT MAY NOT PRODUCE A 500. importTokens is bounded
  // (depth, node count) and reports rather than throws, but this is the trust
  // boundary: anything unforeseen in it becomes a 400 naming the file, never an
  // unhandled exception. The catch is deliberately outside the write branch —
  // nothing below it has run yet, so "imports nothing" still holds.
  let result: ReturnType<typeof importTokens>
  try {
    result = importTokens(base, dark ?? null, {
      curatedFonts: CURATED_FONT_WEIGHTS,
      current,
    })
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: `the file could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
    })
  }

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
