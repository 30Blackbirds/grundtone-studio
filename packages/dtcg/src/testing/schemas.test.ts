import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VENDOR_DIR, validateAgainst } from './validate'

// Instrument check before the export is judged by it: the vendored schemas
// must classify the official fixtures the way their manifests say. A schema
// set that accepted everything (a broken $ref, a missing file) would make
// every export test below pass for the wrong reason.

interface ManifestTest {
  id: string
  type: 'PositiveEvaluationTest' | 'NegativeEvaluationTest'
  input: string
  features?: string[]
}

const suiteDir = join(VENDOR_DIR, 'test-suite/2025.10')
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

describe.each(['format', 'resolver'])('vendored %s schema vs the official fixtures', (suite) => {
  const manifest = read(join(suiteDir, suite, 'manifest.json')) as {
    schemaId: string
    tests: ManifestTest[]
  }
  // Fixtures marked preprocessing-required need reference resolution that a
  // JSON schema cannot do; upstream's own schema tests skip them the same way.
  const cases = manifest.tests.filter((t) => !t.features?.includes('preprocessing-required'))

  it('has both positive and negative cases to check', () => {
    expect(cases.filter((t) => t.type === 'PositiveEvaluationTest').length).toBeGreaterThan(5)
    expect(cases.filter((t) => t.type === 'NegativeEvaluationTest').length).toBeGreaterThan(5)
  })

  it.each(cases.map((t) => [t.id, t] as const))('%s', (_, t) => {
    const result = validateAgainst(manifest.schemaId, read(join(suiteDir, suite, t.input)))
    expect(result.valid, result.errors.join('\n')).toBe(t.type === 'PositiveEvaluationTest')
  })
})
