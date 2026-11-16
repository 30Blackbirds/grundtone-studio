import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertRuntimeFlags,
  authorizerKind,
  billingEnabled,
  billingState,
  requireBillingEnabled,
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

describe('FEATURE_BILLING', () => {
  it('on and off are the only values', () => {
    expect(billingState('on')).toBe('on')
    expect(billingState('off')).toBe('off')
  })

  it('billingEnabled reads the process environment', () => {
    process.env.FEATURE_BILLING = 'off'
    expect(billingEnabled()).toBe(false)
    process.env.FEATURE_BILLING = 'on'
    expect(billingEnabled()).toBe(true)
  })

  it.each([[undefined], [''], ['true'], ['1'], ['OFF']])('refuses %j', (value) => {
    expect(() => billingState(value)).toThrow(RuntimeFlagError)
  })
})

describe('assertRuntimeFlags (the boot check)', () => {
  it('passes when both are set', () => {
    expect(() => assertRuntimeFlags({ AUTHORIZER: 'local', FEATURE_BILLING: 'off' })).not.toThrow()
  })

  it('names EVERY missing value in one refusal, not only the first', () => {
    try {
      assertRuntimeFlags({})
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeFlagError)
      expect((err as Error).message).toContain('AUTHORIZER')
      expect((err as Error).message).toContain('FEATURE_BILLING')
    }
  })

  it('refuses when only one is missing', () => {
    expect(() => assertRuntimeFlags({ AUTHORIZER: 'pdp' })).toThrow(/FEATURE_BILLING/)
    expect(() => assertRuntimeFlags({ FEATURE_BILLING: 'on' })).toThrow(/AUTHORIZER/)
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

describe('requireBillingEnabled', () => {
  it('returns when billing is on', () => {
    process.env.FEATURE_BILLING = 'on'
    expect(() => requireBillingEnabled()).not.toThrow()
  })

  it('answers 404 billing_off when billing is off', () => {
    process.env.FEATURE_BILLING = 'off'
    try {
      requireBillingEnabled()
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as { statusCode: number }).statusCode).toBe(404)
      expect((err as { data: { code: string } }).data.code).toBe('billing_off')
    } finally {
      process.env.FEATURE_BILLING = 'on'
    }
  })

  // All four billing routes must ask, or one of them stays reachable when off.
  it.each([
    ['checkout-session.post.ts'],
    ['entitlements-refresh.post.ts'],
    ['overview.get.ts'],
    ['portal-session.post.ts'],
  ])('server/api/billing/%s calls it first', (file) => {
    const source = readFileSync(new URL(`../api/billing/${file}`, import.meta.url), 'utf8')
    expect(source).toMatch(/defineEventHandler\(async \(event\) => \{\s*requireBillingEnabled\(\)/)
  })
})
