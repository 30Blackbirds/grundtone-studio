import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertRuntimeFlags,
  authorizerKind,
  parseRuntimeFlag,
  RuntimeFlagError,
} from './runtime-flags'

describe('AUTHORIZER', () => {
  it.each([['pdp'], ['local']])('accepts %j', (value) => {
    expect(authorizerKind(value)).toBe(value)
  })

  // 🔴 No default: a missing value must not quietly become either authorizer.
  it.each([[undefined], [''], ['PDP'], ['local '], ['none']])('refuses %j', (value) => {
    expect(() => authorizerKind(value)).toThrow(RuntimeFlagError)
  })

  it('names the variable and the allowed values', () => {
    expect(() => authorizerKind(undefined)).toThrow(/AUTHORIZER is unset.*pdp \| local/)
  })
})

describe('parseRuntimeFlag (the rule a layer reuses for its own switch)', () => {
  it('returns an allowed value and refuses anything else with the same message shape', () => {
    expect(parseRuntimeFlag('X_FLAG', 'a', ['a', 'b'], 'why.')).toBe('a')
    expect(() => parseRuntimeFlag('X_FLAG', 'c', ['a', 'b'], 'why.')).toThrow(
      /refusing to start: X_FLAG is "c"; set it to one of a \| b\. why\./,
    )
  })
})

describe('assertRuntimeFlags (the boot check)', () => {
  it('passes when AUTHORIZER is set', () => {
    expect(() => assertRuntimeFlags({ AUTHORIZER: 'local' })).not.toThrow()
  })

  it('refuses when AUTHORIZER is missing', () => {
    expect(() => assertRuntimeFlags({})).toThrow(/AUTHORIZER/)
  })

  // Losing the plugin's call would fail OPEN: the process would start and only
  // refuse per request. This cell reads the file that wires it.
  it('the Nitro plugin calls it', () => {
    const source = readFileSync(
      new URL('../plugins/assert-runtime-flags.ts', import.meta.url),
      'utf8',
    )
    expect(source).toMatch(/defineNitroPlugin\(\(\) => \{\s*assertRuntimeFlags\(\)/)
  })
})
