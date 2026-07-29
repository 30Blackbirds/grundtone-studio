import { describe, it, expect } from 'vitest'
import { resolveConfig, applySets, pickTokensBase } from './config'

describe('resolveConfig', () => {
  const base = { projectId: 'p1', flags: {}, env: {}, configFile: null }

  it('prefers flags over env over config file', () => {
    const cfg = resolveConfig({
      ...base,
      flags: { apiBase: 'https://flag', key: 'sk_live_flag' },
      env: { GRUNDTONE_API_BASE: 'https://env', GRUNDTONE_TOKEN_KEY: 'sk_live_env' },
      configFile: { apiBase: 'https://file', keys: { p1: 'sk_live_file' } },
    })
    expect(cfg).toEqual({ apiBase: 'https://flag', key: 'sk_live_flag' })
  })

  it('falls back to env then per-project config key', () => {
    const cfg = resolveConfig({
      ...base,
      env: { GRUNDTONE_API_BASE: 'https://env/' },
      configFile: { keys: { p1: 'sk_live_p1' } },
    })
    expect(cfg).toEqual({ apiBase: 'https://env', key: 'sk_live_p1' })
  })

  it('uses the config default key only when the project has none', () => {
    expect(
      resolveConfig({
        ...base,
        flags: { apiBase: 'https://x' },
        configFile: { keys: { default: 'sk_live_default' } },
      }).key,
    ).toBe('sk_live_default')
  })

  it('strips trailing slashes from the api base', () => {
    expect(resolveConfig({ ...base, flags: { apiBase: 'https://x//', key: 'sk_a' } }).apiBase).toBe(
      'https://x',
    )
  })

  it('throws when no api base is resolvable', () => {
    expect(() => resolveConfig({ ...base, flags: { key: 'sk_a' } })).toThrow(/API base/)
  })

  it('throws when no key is resolvable', () => {
    expect(() => resolveConfig({ ...base, flags: { apiBase: 'https://x' } })).toThrow(/secret key/)
  })

  it('rejects a publishable pk_ key', () => {
    expect(() =>
      resolveConfig({ ...base, flags: { apiBase: 'https://x', key: 'pk_live_abc' } }),
    ).toThrow(/secret key/)
  })
})

describe('applySets', () => {
  it('sets a nested dot-path, creating intermediate objects', () => {
    expect(applySets({}, ['colors.primary=#0059b3'])).toEqual({
      colors: { primary: '#0059b3' },
    })
  })

  it('does not mutate the input', () => {
    const input = { colors: { primary: '#000' } }
    applySets(input, ['colors.primary=#fff'])
    expect(input.colors.primary).toBe('#000')
  })

  it('overwrites a non-object intermediate with an object', () => {
    expect(applySets({ colors: 'oops' }, ['colors.primary=#fff'])).toEqual({
      colors: { primary: '#fff' },
    })
  })

  it('applies multiple assignments and keeps siblings', () => {
    expect(
      applySets({ colors: { secondary: '#111' } }, ['colors.primary=#0059b3', 'radius.md=8px']),
    ).toEqual({ colors: { secondary: '#111', primary: '#0059b3' }, radius: { md: '8px' } })
  })

  it('throws on a malformed assignment', () => {
    expect(() => applySets({}, ['no-equals-sign'])).toThrow(/Invalid --set/)
  })
})

describe('pickTokensBase', () => {
  const draft = { tokens: { colors: { primary: '#111111' } } }
  const active = { tokens: { colors: { primary: '#222222' } } }
  const defaults = { colors: { primary: '#333333' } }

  it('unwraps the DRAFT tokens (not the wrapper) when a draft exists', () => {
    expect(pickTokensBase({ draft, active, defaults })).toEqual(draft.tokens)
  })

  it('falls back to the ACTIVE tokens when there is no draft', () => {
    expect(pickTokensBase({ draft: null, active, defaults })).toEqual(active.tokens)
  })

  it('falls back to DEFAULTS when neither draft nor active exists', () => {
    expect(pickTokensBase({ draft: null, active: null, defaults })).toEqual(defaults)
  })

  it('returns {} for a missing/empty config', () => {
    expect(pickTokensBase(null)).toEqual({})
    expect(pickTokensBase({})).toEqual({})
  })

  it('never returns the wrapper shape (id/version must not leak into the POST body)', () => {
    const base = pickTokensBase({
      draft: { tokens: { colors: {} }, ...({ id: 'x', version: 3 } as object) },
    } as never)
    expect(base).not.toHaveProperty('id')
    expect(base).not.toHaveProperty('version')
  })
})
