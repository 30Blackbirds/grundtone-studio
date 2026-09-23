// A DTCG 2025.10 document → flat tokens with resolved types and literal values
// (riff KH-1044, part B). Written here rather than taken from a library: the
// A-spike measured Style Dictionary v5.5.3 declaring its own 2025.10 support
// incomplete (issue #1590), with $ref/$extends/$root unverified there.
//
// 🔴 WHAT THIS IS AND IS NOT. It is a STRUCTURAL parser: groups, tokens, names,
// $type resolution, $extends/$root, and aliases. It is NOT a value validator —
// it does not check that a color's components are in range, and it does not
// know composite types at all. A `border` token parses fine here and is then
// reported as not-mapped by the import. The value rules live in the schema
// validation (src/testing/validate.ts) and in Studio's own tokensSchema, which
// stays the only thing that decides what may be saved (O3).
//
// The cells drive this with the OFFICIAL vendored fixtures: every
// negative/{references,token-name,group,metadata} fixture must be rejected, and
// every positive fixture must parse. Those four categories are exactly the ones
// whose failure is structural; the value-level negatives are out of its scope
// and the cells say so.

/** Stable identifiers, so a UI can translate the reason. */
export type ParseErrorCode =
  | 'document_not_object'
  | 'value_and_children'
  | 'invalid_name'
  | 'unknown_dollar_property'
  | 'type_missing'
  | 'type_not_string'
  | 'type_unknown'
  | 'metadata_invalid'
  | 'alias_syntax'
  | 'alias_unresolved'
  | 'alias_cycle'
  | 'alias_in_subvalue'
  | 'alias_type_mismatch'
  | 'value_shape'
  | 'pointer_syntax'
  | 'pointer_unresolved'
  | 'pointer_not_value'
  | 'extends_not_group'
  | 'extends_unresolved'
  | 'extends_cycle'

export interface ParseError {
  code: ParseErrorCode
  /** Dotted path of the offending token or group; '(root)' for the document. */
  path: string
  reason: string
}

export interface ParsedToken {
  /** Path segments, e.g. ['color', 'primary']. */
  path: string[]
  /** Resolved $type: own, else the alias target's, else the nearest group's. */
  type: string
  /** $value with every alias and $ref replaced by the literal it points to. */
  value: unknown
  /** $value as written, before alias resolution — for the report. */
  raw: unknown
  /** Vendor extensions as written; never saved, only reported (I9). */
  extensions?: Record<string, unknown>
}

export interface ParseResult {
  tokens: ParsedToken[]
  errors: ParseError[]
}

// Format §8: the metadata properties a group or token may carry. Anything else
// starting with `$` is an error rather than a silently ignored key — the
// negative fixture `unsupported-dollar-property` requires that.
const GROUP_META = new Set(['$type', '$description', '$extensions', '$deprecated', '$schema'])
const TOKEN_META = new Set([...GROUP_META, '$value', '$ref'])
const STRUCTURE = new Set(['$extends', '$root'])

// Format §7.2: the types the spec defines. An unknown $type is an error
// (negative fixture `type-unknown`), which is not the same as a type this
// package cannot MAP — mapping is the import's problem, not the parser's.
const KNOWN_TYPES = new Set([
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'cubicBezier',
  'number',
  'strokeStyle',
  'border',
  'transition',
  'shadow',
  'gradient',
  'typography',
])

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Format §5.1.1: no leading `$`, and no `{`, `}` or `.` anywhere. */
export function validTokenName(name: string): boolean {
  return (
    name.length > 0 && !name.startsWith('$') && !/[{}.]/.test(name) && !PROTOTYPE_KEYS.has(name)
  )
}

const ALIAS = /^\{([^{}]*)\}$/
const CONTAINS_BRACE = /[{}]/

// Format §6: a sub-value may itself be a reference only where the type HAS
// sub-values. In a color's or dimension's own value object a `{…}` is a
// malformed reference, not a nested alias (negative fixtures
// {color,dimension,duration,cubicBezier}-curly-brace-in-subvalue).
const COMPOSITE_TYPES = new Set([
  'border',
  'transition',
  'shadow',
  'gradient',
  'typography',
  'strokeStyle',
])

// 🔴 THE SHAPE OF A RESOLVED VALUE, for the PRIMITIVE types only.
//
// Measured, and the reason this exists: the official JSON schema ACCEPTS 7 of
// the 8 `negative/references` fixtures that reference a value of the wrong
// shape — a schema cannot follow a $ref, so it validates the `{$ref: …}` object
// and never sees what it points at. The parser is the only place that has the
// RESOLVED value, so if it does not check the shape, nothing does.
//
// Composite sub-values (a shadow whose colour is an array, a gradient stop of
// the wrong type) are NOT checked here — that needs a full composite value
// model, which Studio never maps. Those 5 fixtures are named in the cells and
// tracked; see the riff. This function deliberately covers exactly the types
// an import can map, plus the primitives they can be confused with.
function shapeOf(type: string, value: unknown): string | null {
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  switch (type) {
    case 'color':
      return isObject(value) &&
        typeof value.colorSpace === 'string' &&
        Array.isArray(value.components) &&
        value.components.length === 3
        ? null
        : 'a color needs colorSpace and three components'
    case 'dimension':
      return isObject(value) && isNum(value.value) && typeof value.unit === 'string'
        ? null
        : 'a dimension needs a numeric value and a unit'
    case 'duration':
      return isObject(value) && isNum(value.value) && typeof value.unit === 'string'
        ? null
        : 'a duration needs a numeric value and a unit'
    case 'fontFamily':
      return typeof value === 'string' ||
        (Array.isArray(value) && value.every((v) => typeof v === 'string'))
        ? null
        : 'a fontFamily is a string or an array of strings'
    case 'fontWeight':
      return isNum(value) || typeof value === 'string'
        ? null
        : 'a fontWeight is a number or a keyword'
    case 'number':
      return isNum(value) ? null : 'not a number'
    case 'cubicBezier':
      return Array.isArray(value) && value.length === 4 && value.every(isNum)
        ? null
        : 'a cubicBezier is four numbers'
    default:
      // Composite types and anything else: not checked here (see above).
      return null
  }
}

class Parser {
  readonly errors: ParseError[] = []
  readonly tokens = new Map<string, ParsedToken>()
  /** Groups sitting on an $extends cycle; they are not expanded. */
  cycles = new Set<string>()
  /** Every token's declared $type before alias resolution, for target lookups. */
  private declared = new Map<string, string | undefined>()
  private rawValues = new Map<string, unknown>()
  private refs = new Map<string, string>()

  constructor(private readonly document: Record<string, unknown>) {}

  fail(code: ParseErrorCode, path: string, reason: string): void {
    this.errors.push({ code, path, reason })
  }

  // ── $extends / $root ───────────────────────────────────────────────────
  // A group may extend another group ({path} syntax) and is then deep-merged
  // onto it. Own keys win. A cycle names the groups in it.
  /**
   * Collect every $extends edge from the document as written, BEFORE anything
   * is expanded. Deleting the marker while walking made a cycle invisible to
   * itself: A→B was resolved first, and by the time B→A was read, A no longer
   * carried the marker that proved the cycle.
   */
  edges(node: Record<string, unknown>, path: string[], out: Map<string, string>): void {
    const ref = node.$extends
    if (typeof ref === 'string') {
      const target = ALIAS.exec(ref)?.[1]
      if (target !== undefined) out.set(path.join('.'), target)
    }
    for (const [key, value] of Object.entries(node)) {
      if (!key.startsWith('$') && isObject(value)) this.edges(value, [...path, key], out)
      if (key === '$root' && isObject(value)) this.edges(value, path, out)
    }
  }

  /** Report every group that sits on an $extends cycle, naming the cycle. */
  findExtendsCycles(edges: Map<string, string>): Set<string> {
    const onCycle = new Set<string>()
    for (const start of edges.keys()) {
      const seen: string[] = []
      let at: string | undefined = start
      while (at !== undefined && edges.has(at)) {
        if (seen.includes(at)) {
          const cycle = seen.slice(seen.indexOf(at))
          if (cycle.includes(start)) {
            this.fail('extends_cycle', start, `$extends cycle: ${[...cycle, at].join(' → ')}`)
            onCycle.add(start)
          }
          break
        }
        seen.push(at)
        at = edges.get(at)
      }
    }
    return onCycle
  }

  expand(node: Record<string, unknown>, path: string[], seen: string[]): void {
    const extendsRef = node.$extends
    if (extendsRef !== undefined) {
      delete node.$extends
      const here = path.join('.') || '(root)'
      if (this.cycles.has(here)) return
      if (typeof extendsRef !== 'string' || !ALIAS.test(extendsRef)) {
        this.fail('extends_unresolved', here, '$extends must be a {group.path} reference')
      } else {
        const target = ALIAS.exec(extendsRef)![1]!
        if (seen.includes(target)) {
          this.fail('extends_cycle', here, `$extends cycle: ${[...seen, target].join(' → ')}`)
        } else {
          const source = this.lookup(target.split('.'))
          if (!isObject(source)) {
            this.fail('extends_unresolved', here, `$extends target ${target} does not exist`)
          } else if (source.$value !== undefined || source.$ref !== undefined) {
            this.fail(
              'extends_not_group',
              here,
              `$extends target ${target} is a token, not a group`,
            )
          } else {
            const copy = structuredClone(source) as Record<string, unknown>
            this.expand(copy, target.split('.'), [...seen, target])
            for (const [key, value] of Object.entries(copy)) {
              if (!Object.hasOwn(node, key)) node[key] = value
            }
          }
        }
      }
    }
    // $root: the group itself is also a token. It becomes a token at the
    // group's own path, which is what makes `{group}` resolvable.
    for (const [key, value] of Object.entries(node)) {
      if (key === '$root' || (!key.startsWith('$') && isObject(value))) {
        this.expand(value as Record<string, unknown>, key === '$root' ? path : [...path, key], seen)
      }
    }
  }

  private lookup(segments: string[]): unknown {
    let node: unknown = this.document
    for (const segment of segments) {
      if (!isObject(node)) return undefined
      node = Object.hasOwn(node, segment) ? node[segment] : undefined
    }
    return node
  }

  // ── walk ───────────────────────────────────────────────────────────────
  walk(node: Record<string, unknown>, path: string[], groupType: string | undefined): void {
    const here = path.join('.') || '(root)'
    const ownType = node.$type
    if (ownType !== undefined && typeof ownType !== 'string') {
      this.fail('type_not_string', here, '$type must be a string')
      return
    }
    if (typeof ownType === 'string' && !KNOWN_TYPES.has(ownType)) {
      this.fail('type_unknown', here, `unknown $type "${ownType}"`)
      return
    }
    if (node.$description !== undefined && typeof node.$description !== 'string') {
      this.fail('metadata_invalid', here, '$description must be a string')
      return
    }
    if (
      node.$deprecated !== undefined &&
      !['boolean', 'string'].includes(typeof node.$deprecated)
    ) {
      this.fail('metadata_invalid', here, '$deprecated must be a boolean or a string')
      return
    }
    if (node.$extensions !== undefined && !isObject(node.$extensions)) {
      this.fail('metadata_invalid', here, '$extensions must be an object')
      return
    }

    if (node.$value === null) {
      this.fail('metadata_invalid', here, '$value must not be null')
      return
    }
    if (node.$value !== undefined && node.$ref !== undefined) {
      this.fail('alias_syntax', here, 'a token has either $value or $ref, never both')
      return
    }
    const isToken = node.$value !== undefined || node.$ref !== undefined
    const children = Object.keys(node).filter((k) => !k.startsWith('$'))
    if (isToken && children.length > 0) {
      this.fail('value_and_children', here, 'an object cannot be both a token and a group')
      return
    }

    for (const key of Object.keys(node)) {
      if (!key.startsWith('$')) continue
      const allowed = isToken ? TOKEN_META : GROUP_META
      if (!allowed.has(key) && !STRUCTURE.has(key)) {
        this.fail('unknown_dollar_property', here, `unsupported property "${key}"`)
        return
      }
    }

    const effectiveType = (ownType as string | undefined) ?? groupType
    if (isToken) {
      if (path.length === 0) {
        this.fail('value_and_children', '(root)', 'the document root cannot be a token')
        return
      }
      this.declared.set(here, effectiveType)
      this.rawValues.set(here, node.$ref !== undefined ? { $ref: node.$ref } : node.$value)
      this.tokens.set(here, {
        path: [...path],
        type: effectiveType ?? '',
        value: undefined,
        raw: node.$ref !== undefined ? { $ref: node.$ref } : node.$value,
        ...(isObject(node.$extensions) ? { extensions: node.$extensions } : {}),
      })
      return
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === '$root') {
        // Already expanded onto this path by expand(); parse it as the token
        // living at the group's own path.
        this.walk(value as Record<string, unknown>, path, effectiveType)
        continue
      }
      if (key.startsWith('$')) continue
      if (!validTokenName(key)) {
        this.fail(
          'invalid_name',
          [...path, key].join('.'),
          `"${key}" is not a valid name: no leading $, and no { } or .`,
        )
        continue
      }
      if (isObject(value)) {
        this.walk(value, [...path, key], effectiveType)
      } else {
        this.fail('metadata_invalid', [...path, key].join('.'), 'a group member must be an object')
      }
    }
  }
}

export function parseDocument(document: unknown): ParseResult {
  if (!isObject(document)) {
    return {
      tokens: [],
      errors: [{ code: 'document_not_object', path: '(root)', reason: 'not a JSON object' }],
    }
  }
  const copy = structuredClone(document) as Record<string, unknown>
  const parser = new Parser(copy)
  const edges = new Map<string, string>()
  parser.edges(copy, [], edges)
  parser.cycles = parser.findExtendsCycles(edges)
  parser.expand(copy, [], [])
  parser.walk(copy, [], undefined)
  resolveValues(parser)
  return { tokens: [...parser.tokens.values()], errors: parser.errors }
}

// ── aliases ──────────────────────────────────────────────────────────────
// Resolution is lazy and memoised, with the chain carried along so a cycle can
// name EVERY token in it (I6) rather than only the one the walk happened to
// reach first.
function resolveValues(parser: Parser): void {
  const state = new Map<string, 'resolving' | 'done'>()
  for (const token of parser.tokens.values()) {
    resolveToken(parser, token, state, [])
  }
  for (const token of [...parser.tokens.values()]) {
    if (token.type !== '' && token.value !== undefined) {
      const wrong = shapeOf(token.type, token.value)
      if (wrong) {
        parser.fail(
          'value_shape',
          token.path.join('.'),
          `the value of this "${token.type}" token is wrong after resolution: ${wrong}`,
        )
      }
    }
    if (token.type === '') {
      parser.fail(
        'type_missing',
        token.path.join('.'),
        'no $type on the token, its alias target or any parent group',
      )
      parser.tokens.delete(token.path.join('.'))
    }
  }
}

function resolveToken(
  parser: Parser,
  token: ParsedToken,
  state: Map<string, 'resolving' | 'done'>,
  chain: string[],
): void {
  const key = token.path.join('.')
  if (state.get(key) === 'done') return
  if (state.get(key) === 'resolving') {
    parser.fail('alias_cycle', key, `alias cycle: ${[...chain, key].join(' → ')}`)
    return
  }
  state.set(key, 'resolving')
  token.value = resolveValue(parser, token, token.raw, state, [...chain, key], true)
  state.set(key, 'done')
}

function tokenByPath(parser: Parser, path: string): ParsedToken | undefined {
  return (parser as unknown as { tokens: Map<string, ParsedToken> }).tokens.get(path)
}

function resolveValue(
  parser: Parser,
  token: ParsedToken,
  value: unknown,
  state: Map<string, 'resolving' | 'done'>,
  chain: string[],
  topLevel: boolean,
): unknown {
  const here = token.path.join('.')

  if (typeof value === 'string') {
    const alias = ALIAS.exec(value)
    if (!alias) {
      // A brace anywhere else is a malformed reference, not a literal
      // (negative fixture color-curly-brace-in-subvalue).
      if (CONTAINS_BRACE.test(value)) {
        parser.fail('alias_syntax', here, `"${value}" is not a valid {group.token} reference`)
      }
      return value
    }
    if (!topLevel && !COMPOSITE_TYPES.has(token.type)) {
      parser.fail(
        'alias_in_subvalue',
        here,
        `a reference inside the value of a "${token.type}" token is not allowed; only composite types have sub-values`,
      )
      return undefined
    }
    const target = alias[1]!
    const targetToken = tokenByPath(parser, target)
    if (!targetToken) {
      parser.fail('alias_unresolved', here, `reference {${target}} does not resolve to a token`)
      return undefined
    }
    if (chain.includes(target)) {
      parser.fail('alias_cycle', here, `alias cycle: ${[...chain, target].join(' → ')}`)
      return undefined
    }
    resolveToken(parser, targetToken, state, chain)
    if (topLevel) {
      // The alias also supplies the type when the token declares none, and a
      // declared type must agree with the target's (negative: type-mismatch).
      if (token.type === '') token.type = targetToken.type
      else if (targetToken.type !== '' && token.type !== targetToken.type) {
        parser.fail(
          'alias_type_mismatch',
          here,
          `declares $type "${token.type}" but {${target}} is "${targetToken.type}"`,
        )
        return undefined
      }
    }
    return targetToken.value
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(parser, token, item, state, chain, false))
  }

  if (isObject(value)) {
    if (typeof value.$ref === 'string' && Object.keys(value).length === 1) {
      return resolvePointer(parser, token, value.$ref, state, chain, topLevel)
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        resolveValue(parser, token, v, state, chain, false),
      ]),
    )
  }
  return value
}

// JSON Pointer, restricted by §6.6 to same-document `#/…`. The negatives pin
// the syntax: no `//`, no trailing slash, no spaces, no braces, and the target
// must be inside a token's $value — a group, a token object or a $description
// is not a value.
function resolvePointer(
  parser: Parser,
  token: ParsedToken,
  pointer: string,
  state: Map<string, 'resolving' | 'done'>,
  chain: string[],
  topLevel: boolean,
): unknown {
  const here = token.path.join('.')
  if (
    !pointer.startsWith('#/') ||
    pointer.endsWith('/') ||
    pointer.includes('//') ||
    /\s/.test(pointer) ||
    CONTAINS_BRACE.test(pointer)
  ) {
    parser.fail('pointer_syntax', here, `"${pointer}" is not a same-document JSON Pointer`)
    return undefined
  }
  const segments = pointer
    .slice(2)
    .split('/')
    .map((s) => decodeURIComponent(s).replace(/~1/g, '/').replace(/~0/g, '~'))
  if (!segments.includes('$value')) {
    parser.fail(
      'pointer_not_value',
      here,
      `"${pointer}" does not point into a token's $value (a group, a token object or metadata is not a value)`,
    )
    return undefined
  }

  const cut = segments.indexOf('$value')
  const targetPath = segments.slice(0, cut).join('.')
  const targetToken = tokenByPath(parser, targetPath)
  if (!targetToken) {
    parser.fail('pointer_unresolved', here, `"${pointer}" does not resolve to a token`)
    return undefined
  }
  if (chain.includes(targetPath)) {
    parser.fail('alias_cycle', here, `alias cycle: ${[...chain, targetPath].join(' → ')}`)
    return undefined
  }
  resolveToken(parser, targetToken, state, chain)

  let node: unknown = targetToken.value
  for (const segment of segments.slice(cut + 1)) {
    if (Array.isArray(node)) {
      if (!/^(0|[1-9]\d*)$/.test(segment) || Number(segment) >= node.length) {
        parser.fail('pointer_unresolved', here, `"${pointer}" has no index ${segment}`)
        return undefined
      }
      node = node[Number(segment)]
      continue
    }
    if (!isObject(node) || !Object.hasOwn(node, segment)) {
      parser.fail('pointer_unresolved', here, `"${pointer}" does not resolve`)
      return undefined
    }
    node = node[segment]
  }

  if (topLevel && cut === segments.length - 1) {
    // The whole $value of another token: same type rule as a {} alias.
    if (token.type === '') token.type = targetToken.type
    else if (targetToken.type !== '' && token.type !== targetToken.type) {
      parser.fail(
        'alias_type_mismatch',
        here,
        `declares $type "${token.type}" but ${pointer} is "${targetToken.type}"`,
      )
      return undefined
    }
  }
  return node
}
