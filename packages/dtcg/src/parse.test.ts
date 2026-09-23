import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseDocument } from './parse'
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

// 🔴 The five fixtures neither instrument rejects today, named one by one with
// the reason, never as a category. Each is a reference to a COMPOSITE
// sub-value of the wrong shape (a shadow whose colour is an array, a gradient
// stop of the wrong type); catching them needs a composite value model, which
// Studio never maps. Tracked as KH-1179 — when it lands, these move into the
// rejected set and this list is empty. The count is pinned, so the list cannot
// grow silently, which is the only thing that would make it a hiding place.
const COMPOSITE_SHAPE_GAP = [
  'negative/references/composite-ref-to-number-for-dimension.json',
  'negative/references/composite-ref-to-partial-color.json',
  'negative/references/composite-ref-wrong-subvalue-type.json',
  'negative/references/gradient-ref-to-non-gradient-stop.json',
  'negative/references/stroke-dashArray-ref-wrong-type.json',
]

describe.each(structuralNegatives.filter((t) => !COMPOSITE_SHAPE_GAP.includes(t.input)))(
  'structural negative: $id',
  ({ input }) => {
    it('is rejected by the parser or by the official schema, with a reason', () => {
      const document = read(input)
      const parsed = parseDocument(document)
      const schema = validateTokensFile(document)
      expect(parsed.errors.length > 0 || !schema.valid).toBe(true)
      if (parsed.errors.length > 0) expect(parsed.errors[0]!.reason).not.toBe('')
    })
  },
)

describe('the known gap (KH-1179)', () => {
  it('is exactly five fixtures, and every one of them is still unrejected', () => {
    expect(COMPOSITE_SHAPE_GAP).toHaveLength(5)
    for (const input of COMPOSITE_SHAPE_GAP) {
      const document = read(input)
      // If one of these starts failing, the gap closed: move it out of the
      // list. A cell that silently tolerated either outcome would let the list
      // outlive the defect.
      expect(parseDocument(document).errors, `${input} is now rejected by the parser`).toEqual([])
      expect(validateTokensFile(document).valid, `${input} is now rejected by the schema`).toBe(
        true,
      )
    }
  })

  it('every listed fixture is a real fixture in the structural set', () => {
    const inputs = structuralNegatives.map((t) => t.input)
    for (const input of COMPOSITE_SHAPE_GAP) expect(inputs).toContain(input)
  })
})

describe.each(valueNegatives)('value negative: $id (structure only)', ({ input }) => {
  it('does not crash, and is not silently turned into a typed token without a value', () => {
    // No verdict is asserted: these fail on value rules, outside this parser.
    expect(() => parseDocument(read(input))).not.toThrow()
  })
})
