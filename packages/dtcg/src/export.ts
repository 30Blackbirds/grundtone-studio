import {
  type OmitCode,
  type NoteCode,
  cssColorToDtcg,
  cssFontFamilyToDtcg,
  cssLengthToDtcg,
  type Conversion,
  type DtcgColor,
  type DtcgDimension,
} from './convert'

// Export of a Studio token set to DTCG 2025.10 (riff KH-1005, part A).
//
// The package works on a STRUCTURAL copy of Studio's token shape, not on
// apps/studio's zod schema: that schema imports app modules (plan catalog), and
// the app stays the only validator of what may be saved. apps/studio's
// tests/dtcg-export.test.ts checks at type level that its `Tokens` is
// assignable to `StudioTokens` AND has no key this type lacks, so a field added
// to the schema without an export mapping fails typecheck instead of being
// silently left out of every export.

export const FORMAT_SCHEMA_URL = 'https://www.designtokens.org/schemas/2025.10/format.json'
export const RESOLVER_SCHEMA_URL = 'https://www.designtokens.org/schemas/2025.10/resolver.json'
export const TOKENS_MEDIA_TYPE = 'application/design-tokens+json'
// The resolver spec asks for plain application/json (resolver/filetype.md).
export const RESOLVER_MEDIA_TYPE = 'application/json'
/** Reverse-DNS vendor key for Studio data that has no DTCG type. */
export const EXTENSION_KEY = 'dk.klanghaus.grundtone-studio'

type StringMap = { [key: string]: string | undefined }

export interface StudioFontSlot {
  source: 'curated' | 'custom'
  family: string
  weights: number[]
  fallbacks: string[]
  files?: Record<string, string>
}

export interface StudioTokens {
  colors?: StringMap
  assets?: { logo?: { file: string; type: string } }
  typography?: {
    fontFamily?: { base?: string; heading?: string; mono?: string }
    slots?: { heading?: StudioFontSlot; body?: StudioFontSlot }
  }
  radius?: StringMap
  spacing?: StringMap
  dark?: { colors?: StringMap }
}

export interface ReportEntry {
  code: OmitCode | NoteCode
  /** Studio path, e.g. `colors.primary`. */
  path: string
  /** DTCG path in the exported file, e.g. `color.primary`. */
  target: string
  value: string
  reason: string
}

export interface ExportReport {
  /** Tokens set in Studio that the export attempted: exported + omitted. */
  total: number
  exported: number
  /** Not representable in DTCG; left out of the files (E6). */
  omitted: ReportEntry[]
  /** Exported, but the value was changed on the way (unit, hue, named color). */
  converted: ReportEntry[]
}

export type DtcgGroup = { [key: string]: unknown }

export interface DtcgExport {
  files: {
    base: { name: string; document: DtcgGroup }
    dark: { name: string; document: DtcgGroup } | null
    resolver: { name: string; document: DtcgGroup } | null
  }
  report: ExportReport
}

class Collector {
  readonly report: ExportReport = { total: 0, exported: 0, omitted: [], converted: [] }

  add<T>(
    group: DtcgGroup,
    target: string[],
    path: string,
    raw: string,
    $type: string,
    conversion: Conversion<T>,
  ): void {
    this.report.total++
    const targetPath = target.join('.')
    if (!conversion.ok) {
      this.report.omitted.push({
        code: conversion.code,
        path,
        target: targetPath,
        value: raw,
        reason: conversion.reason,
      })
      return
    }
    this.report.exported++
    if (conversion.note) {
      this.report.converted.push({
        code: conversion.note.code,
        path,
        target: targetPath,
        value: raw,
        reason: conversion.note.text,
      })
    }
    setToken(group, target, { $type, $value: conversion.value })
  }
}

function setToken(root: DtcgGroup, path: string[], token: DtcgGroup): void {
  let node = root
  for (const segment of path.slice(0, -1)) {
    if (!Object.hasOwn(node, segment)) node[segment] = {}
    node = node[segment] as DtcgGroup
  }
  node[path[path.length - 1]!] = token
}

function entries(map: StringMap | undefined): [string, string][] {
  return Object.entries(map ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string')
}

// Token and group names may not start with `$` or contain `{`, `}` or `.`
// (Format §5.1.1). Studio's schema strips unknown keys before a set is saved,
// so this only matters if that ever changes: a stored key must not become a
// broken DTCG name, nor a prototype key while the groups are built.
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
function validName(name: string): boolean {
  return (
    name.length > 0 && !name.startsWith('$') && !/[{}.]/.test(name) && !PROTOTYPE_KEYS.has(name)
  )
}

const INVALID_NAME = {
  ok: false,
  code: 'invalid_name',
  reason: 'the key is not a valid DTCG token name',
} as const

function addColors(c: Collector, doc: DtcgGroup, colors: StringMap | undefined, prefix: string) {
  for (const [slot, value] of entries(colors)) {
    const path = `${prefix}.${slot}`
    const conversion: Conversion<DtcgColor> = validName(slot) ? cssColorToDtcg(value) : INVALID_NAME
    c.add(doc, ['color', slot], path, value, 'color', conversion)
  }
}

function addDimensions(c: Collector, doc: DtcgGroup, group: 'radius' | 'spacing', map?: StringMap) {
  for (const [key, value] of entries(map)) {
    const conversion: Conversion<DtcgDimension> = validName(key)
      ? cssLengthToDtcg(value)
      : INVALID_NAME
    c.add(doc, [group, key], `${group}.${key}`, value, 'dimension', conversion)
  }
}

function addFontSlot(c: Collector, doc: DtcgGroup, name: 'heading' | 'body', slot: StudioFontSlot) {
  const path = `typography.slots.${name}`
  c.add(doc, ['font', name, 'family'], `${path}.family`, slot.family, 'fontFamily', {
    ok: true,
    value: slot.family,
  })
  // Source, fallback keys and file names have no DTCG type; they travel as a
  // vendor extension on the family token. File names only, never bytes or URLs.
  const family = (doc.font as DtcgGroup)[name] as DtcgGroup
  ;(family.family as DtcgGroup).$extensions = {
    [EXTENSION_KEY]: {
      source: slot.source,
      fallbacks: slot.fallbacks,
      ...(slot.files ? { files: slot.files } : {}),
    },
  }
  for (const weight of slot.weights) {
    c.add(
      doc,
      ['font', name, 'weight', String(weight)],
      `${path}.weights`,
      String(weight),
      'fontWeight',
      {
        ok: true,
        value: weight,
      },
    )
  }
}

function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'tokens'
}

/**
 * Studio tokens → DTCG files. `name` is the project slug; it names the files
 * and the resolver document.
 */
export function exportTokens(tokens: StudioTokens, { name }: { name: string }): DtcgExport {
  const c = new Collector()
  const slug = fileSlug(name)
  const base: DtcgGroup = { $schema: FORMAT_SCHEMA_URL }

  if (tokens.assets?.logo) {
    base.$extensions = {
      [EXTENSION_KEY]: { logo: { file: tokens.assets.logo.file, type: tokens.assets.logo.type } },
    }
  }
  addColors(c, base, tokens.colors, 'colors')
  addDimensions(c, base, 'radius', tokens.radius)
  addDimensions(c, base, 'spacing', tokens.spacing)
  for (const [key, value] of entries(tokens.typography?.fontFamily)) {
    c.add(
      base,
      ['font', 'family', key],
      `typography.fontFamily.${key}`,
      value,
      'fontFamily',
      validName(key) ? cssFontFamilyToDtcg(value) : INVALID_NAME,
    )
  }
  for (const slotName of ['heading', 'body'] as const) {
    const slot = tokens.typography?.slots?.[slotName]
    if (slot) addFontSlot(c, base, slotName, slot)
  }

  const baseName = `${slug}.tokens.json`
  const darkColors = entries(tokens.dark?.colors)
  if (darkColors.length === 0) {
    return {
      files: { base: { name: baseName, document: base }, dark: null, resolver: null },
      report: c.report,
    }
  }

  const dark: DtcgGroup = { $schema: FORMAT_SCHEMA_URL }
  addColors(c, dark, tokens.dark?.colors, 'dark.colors')
  const darkName = `${slug}.dark.tokens.json`
  const resolver: DtcgGroup = {
    $schema: RESOLVER_SCHEMA_URL,
    name: slug,
    version: '2025.10',
    sets: { base: { sources: [{ $ref: baseName }] } },
    modifiers: {
      theme: {
        contexts: { light: [], dark: [{ $ref: darkName }] },
        default: 'light',
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  }
  return {
    files: {
      base: { name: baseName, document: base },
      dark: { name: darkName, document: dark },
      resolver: { name: `${slug}.resolver.json`, document: resolver },
    },
    report: c.report,
  }
}
