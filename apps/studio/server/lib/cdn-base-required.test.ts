import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertCdnBaseConfigured, CdnBaseMissingError } from './cdn-base-required'

describe('assertCdnBaseConfigured', () => {
  it('🔴 refuses to start in production with no host', () => {
    expect(() => assertCdnBaseConfigured('', 'production')).toThrow(CdnBaseMissingError)
    expect(() => assertCdnBaseConfigured(undefined, 'production')).toThrow(CdnBaseMissingError)
  })

  it('treats whitespace as no host — a host of one space is not a host', () => {
    expect(() => assertCdnBaseConfigured('   ', 'production')).toThrow(CdnBaseMissingError)
  })

  it('names the variable and what would otherwise happen', () => {
    // A refusal that does not say which value to set is a refusal someone has
    // to read the source to act on.
    try {
      assertCdnBaseConfigured('', 'production')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain('NUXT_PUBLIC_CDN_BASE')
      expect((err as Error).message).toContain('request origin')
    }
  })

  it('allows a configured host in production', () => {
    expect(() => assertCdnBaseConfigured('https://cdn.grundtone.com', 'production')).not.toThrow()
  })

  it.each([['development'], ['test'], [undefined]])(
    '🔴 does NOT refuse outside production (NODE_ENV=%j)',
    (nodeEnv) => {
      // The discriminating pair. Without this, the guard would break every dev
      // machine and every test run — and the cure would be to delete it.
      expect(() => assertCdnBaseConfigured('', nodeEnv)).not.toThrow()
    },
  )
})

describe('the plugin that decides when it is asked', () => {
  it('🔴 still calls the assertion', () => {
    // This cell GREPS, and therefore cannot see whether Nitro loads the file or
    // whether the call is reached — only that the call is written. It exists
    // because losing the call fails OPEN: the app would boot happily and serve
    // the wrong host. dev-auth-bypass has the same cell for the same reason,
    // and it caught exactly this: a call that survived only as a comment.
    const source = readFileSync(new URL('../plugins/assert-cdn-base.ts', import.meta.url), 'utf8')
    const withoutComments = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(withoutComments).toContain('assertCdnBaseConfigured(')
  })
})
