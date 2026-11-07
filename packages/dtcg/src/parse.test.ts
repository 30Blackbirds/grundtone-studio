import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { checkBounds, COMPOSITE_TYPES, MAX_DEPTH, MAX_NODES, parseDocument } from './parse'
import { MAPPED_TYPES } from './import'
import { VENDOR_DIR, validateTokensFile } from './testing/validate'

// The parser is driven by the OFFICIAL 2025.10 test suite, vendored unchanged
// (vendor/.../SOURCE.md). Hand-written examples would only prove that the
// parser agrees with the parser's author.
//
// 🔴 SYNSFELT, stated so the green says what it is worth. The parser is
// STRUCTURAL: names, groups, $type resolution, $extends/$root, aliases and
// JSON Pointers. It does not validate values. So the cells assert:
//   positives                                  → must parse with no error
//   negatives in references/token-name/group/metadata → must be REJECTED by the
//     parser OR by the official schema. The union is the honest instrument:
//     measured, the schema ACCEPTS 7 of the 8 wrong-shape reference fixtures
//     (it cannot follow a $ref), and the parser cannot see a composite
//     sub-value shape. Each instrument is blind where the other is not.
//   every other negative (colors, borders, gradients, …) → NOT asserted here;
//     those documents are structurally fine and fail on VALUE rules, which are
//     the schema's job (testing/validate.ts) and Studio's tokensSchema.
// The counts below are asserted, so the day a fixture is added or the
// categories move, the cell says so instead of quietly measuring less.

const SUITE = join(VENDOR_DIR, 'test-suite/2025.10/format')
const STRUCTURAL = ['references', 'token-name', 'group', 'metadata']

interface ManifestTest {
  id: string
  type: string
  input: string
}

const tests = (
  JSON.parse(readFileSync(join(SUITE, 'manifest.json'), 'utf8')) as { tests: ManifestTest[] }
).tests
const read = (input: string) => JSON.parse(readFileSync(join(SUITE, input), 'utf8')) as unknown

const positives = tests.filter((t) => t.type === 'PositiveEvaluationTest')
const negatives = tests.filter((t) => t.type === 'NegativeEvaluationTest')
const structuralNegatives = negatives.filter((t) =>
  STRUCTURAL.some((c) => t.input.startsWith(`negative/${c}/`)),
)
const valueNegatives = negatives.filter((t) => !structuralNegatives.includes(t))

describe('the vendored suite is the instrument', () => {
  it('has the fixture counts the cells below assume', () => {
    expect(tests).toHaveLength(220)
    expect(positives).toHaveLength(93)
    expect(structuralNegatives.length).toBeGreaterThan(30)
    expect(structuralNegatives.length + valueNegatives.length).toBe(127)
  })
})

describe.each(positives)('positive: $id', ({ input }) => {
  it('parses with no structural error', () => {
    const result = parseDocument(read(input))
    expect(result.errors).toEqual([])
    // Not `tokens.length > 0`: `group-empty-group` is a POSITIVE fixture with
    // no tokens at all, and asserting otherwise made the cell wrong, not the
    // parser.
    expect(Array.isArray(result.tokens)).toBe(true)
  })
})

// 🔴 The exception list is GONE (KH-1179 closed). It used to name five
// fixtures that neither the parser nor the official schema rejected — each a
// reference to a composite sub-value of the wrong shape. They are now in the
// set below like every other negative, and the cells that follow assert it was
// the PARSER that closed them, because "parser or schema" would have been
// satisfiable by the wrong instrument.
const CLOSED_BY_THE_PARSER = [
  'negative/references/composite-ref-to-number-for-dimension.json',
  'negative/references/composite-ref-to-partial-color.json',
  'negative/references/composite-ref-wrong-subvalue-type.json',
  'negative/references/gradient-ref-to-non-gradient-stop.json',
  'negative/references/stroke-dashArray-ref-wrong-type.json',
]

describe.each(structuralNegatives)('structural negative: $id', ({ input }) => {
  it('is rejected by the parser or by the official schema, with a reason', () => {
    const document = read(input)
    const parsed = parseDocument(document)
    const schema = validateTokensFile(document)
    expect(parsed.errors.length > 0 || !schema.valid).toBe(true)
    if (parsed.errors.length > 0) expect(parsed.errors[0]!.reason).not.toBe('')
  })
})

describe('composite sub-value shapes (KH-1179, closed)', () => {
  it('🔴 rejects all five by the PARSER, not by the schema', () => {
    expect(CLOSED_BY_THE_PARSER).toHaveLength(5)
    for (const input of CLOSED_BY_THE_PARSER) {
      const document = read(input)
      const errors = parseDocument(document).errors
      // The load-bearing assertion. A schema cannot follow a $ref, so it
      // validates the `{$ref: …}` object and never sees the resolved value —
      // it accepts 7 of the 8 reference negatives. Asserting "parser OR
      // schema" here would pass on the one instrument that structurally
      // cannot see this class.
      expect(errors.length, `${input} is not rejected by the parser`).toBeGreaterThan(0)
      expect(errors[0]!.code).toBe('value_shape')
      // …and the reason names the PART, not just the token: "wrong shape" on a
      // five-part composite sends the reader looking at all five.
      expect(errors[0]!.reason).not.toBe('')
    }
  })

  it('names which sub-value is wrong, not just that something is', () => {
    const cases: [string, string][] = [
      ['negative/references/composite-ref-to-number-for-dimension.json', 'width'],
      ['negative/references/composite-ref-to-partial-color.json', 'color'],
      ['negative/references/composite-ref-wrong-subvalue-type.json', 'color'],
      ['negative/references/gradient-ref-to-non-gradient-stop.json', 'gradient stop 0'],
      ['negative/references/stroke-dashArray-ref-wrong-type.json', 'dashArray entry 0'],
    ]
    for (const [input, part] of cases) {
      expect(parseDocument(read(input)).errors[0]!.reason).toContain(part)
    }
  })

  // 🔴 A GUARD ON THE DENOMINATOR, kept from when this was a known gap
  // ([projektleder] on #319). The old version tied the gap to MAPPED_TYPES;
  // this one ties the COVERAGE to the type set, which is the thing that can
  // now grow silently: a composite type added to COMPOSITE_TYPES without a
  // shape rule is unchecked in exactly the way these five were, and no other
  // cell would turn red.
  it('every composite type has a shape rule', () => {
    const unchecked = [...COMPOSITE_TYPES].filter((type) => {
      // 🔴 Driven through parseDocument, not by reading the source: a cell that
      // greps for a `case` label stays green when the case returns null. `42`
      // cannot be a valid value for ANY composite type, so a parser that says
      // nothing about it is a parser that is not looking.
      const errors = parseDocument({ t: { $type: type, $value: 42 } }).errors
      return !errors.some((e) => e.code === 'value_shape')
    })
    expect(
      unchecked,
      `${unchecked.join(', ')} is in COMPOSITE_TYPES with no shape rule — a reference to a sub-value of the wrong shape would pass, which is exactly what KH-1179 was.`,
    ).toEqual([])
  })

  it("leaves Studio's mapped set alone: closing the gap is not a licence to map composites", () => {
    // Mapping a new type is a Studio decision with its own import cells; this
    // riff only made the PACKAGE honest about DTCG documents.
    expect([...MAPPED_TYPES].sort()).toEqual(['color', 'dimension', 'fontFamily', 'fontWeight'])
  })

  it('every listed fixture is a real fixture in the structural set', () => {
    const inputs = structuralNegatives.map((t) => t.input)
    for (const input of CLOSED_BY_THE_PARSER) expect(inputs).toContain(input)
  })
})

describe.each(valueNegatives)('value negative: $id (structure only)', ({ input }) => {
  it('does not crash, and is not silently turned into a typed token without a value', () => {
    // No verdict is asserted: these fail on value rules, outside this parser.
    expect(() => parseDocument(read(input))).not.toThrow()
  })
})

describe('bounds on a foreign document ([sikkerhed] on #319)', () => {
  // The defect these cells pin: parseDocument used to THROW RangeError on a
  // deeply nested document — a 30 KB file, far under any size cap — because
  // every walker recurses. A throw on a write path is a 500, not a refusal.
  const deep = (depth: number) => {
    const root: Record<string, unknown> = {}
    let node = root
    for (let i = 0; i < depth; i++) {
      const child: Record<string, unknown> = {}
      node[`g${i}`] = child
      node = child
    }
    node.token = { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } }
    return root
  }

  // The serialised length of a `deep()` document, measured WITHOUT recursion.
  // 🔴 `JSON.stringify(deep(5000))` is itself a recursive walker: on Linux
  // (node 24.20.0, arm64) it overflowed the stack before parseDocument ever
  // ran, so the cell failed on its own sanity line and turbo aborted the rest
  // of the suite. On macOS the larger frame budget hid it.
  const jsonLength = (document: Record<string, unknown>) => {
    let length = 0
    let node = document
    for (;;) {
      const key = Object.keys(node).find((k) => /^g\d+$/.test(k))
      // The innermost group holds only the token: shallow, safe to stringify.
      if (key === undefined) return length + JSON.stringify(node).length
      // `{` + `"key"` + `:` + child + `}`
      length += 1 + JSON.stringify(key).length + 1 + 1
      node = node[key] as Record<string, unknown>
    }
  }

  it('measures a deep document the way JSON.stringify does (control for jsonLength)', () => {
    for (const depth of [0, 1, 10, 500]) {
      expect(jsonLength(deep(depth))).toBe(JSON.stringify(deep(depth)).length)
    }
  })

  it('refuses a document deeper than the limit instead of throwing', () => {
    const document = deep(5000)
    expect(jsonLength(document)).toBeLessThan(200_000) // small, yet fatal before
    let result!: ReturnType<typeof parseDocument>
    expect(() => {
      result = parseDocument(document)
    }).not.toThrow()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'too_deep', path: '(root)' })])
    expect(result.tokens).toEqual([])
  })

  it('accepts a document just inside the depth limit, so the bound is not vacuous', () => {
    // The token adds four levels of its own on top of the groups (token object,
    // $value, the components array, its numbers), so the group count is the
    // limit minus those. Getting this wrong made the cell fail first time,
    // which is how the arithmetic got measured instead of assumed.
    const result = parseDocument(deep(MAX_DEPTH - 5))
    expect(result.errors).toEqual([])
    expect(result.tokens).toHaveLength(1)
  })

  it('refuses a document with more nodes than the limit', () => {
    const wide: Record<string, unknown> = { $type: 'color' }
    for (let i = 0; i < MAX_NODES + 10; i++) wide[`c${i}`] = {}
    const result = parseDocument(wide)
    expect(result.errors[0]).toMatchObject({ code: 'too_many_nodes' })
  })

  it('the bound is measured without recursing, so it survives what it measures', () => {
    // checkBounds is the one function that must never throw on the input it is
    // there to reject; a recursive probe would hit the same stack limit.
    expect(() => checkBounds(deep(200_000))).not.toThrow()
    expect(checkBounds(deep(200_000))?.code).toBeDefined()
  })
})
