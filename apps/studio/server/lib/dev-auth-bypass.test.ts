import { afterEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import {
  DEV_BYPASS_USER,
  isDevBypassSubject,
  assertBypassNotLeaked,
  DEV_AUTH_BYPASS_MISCONFIGURED,
  devAuthBypassEnabled,
  isLoopbackHost,
} from './dev-auth-bypass'

// Riff: the local design-review bypass. These cells exist for one reason —
// every one of them describes a way the bypass could open somewhere it must
// not. A green here is not "the feature works"; it is "each gate still refuses
// on its own".

const eventWithHost = (host: string | undefined) =>
  ({
    node: { req: { headers: host === undefined ? {} : { host } } },
    headers: new Headers(host === undefined ? {} : { host }),
  }) as unknown as H3Event

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
  vi.unstubAllEnvs()
})

describe('the three gates', () => {
  it('opens only when all three hold', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(eventWithHost('localhost:3020'))).toBe(true)
  })

  // 🔴 EACH GATE ALONE. Written as three separate expectations rather than one
  // loop over a table, because the interesting claim is that removing ANY ONE
  // closes it — a table that shared a bug would pass all three rows together.
  it('closes when NODE_ENV is not development, even with the variable set', () => {
    process.env.NODE_ENV = 'production'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(eventWithHost('localhost:3020'))).toBe(false)
  })

  it('closes in development when the variable is absent', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.STUDIO_DEV_AUTH_BYPASS
    expect(devAuthBypassEnabled(eventWithHost('localhost:3020'))).toBe(false)
  })

  it('closes for a caller that is not on loopback, however the process is configured', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    for (const host of [
      'studio.grundtone.com',
      '192.168.1.40:3020',
      'localhost.evil.example',
      'notlocalhost',
      undefined,
    ]) {
      expect(devAuthBypassEnabled(eventWithHost(host)), String(host)).toBe(false)
    }
  })

  // The positive control for the cell above: without it, a host check that
  // rejected EVERYTHING would look like a perfect guard.
  it('accepts the loopback spellings a browser actually sends', () => {
    for (const host of ['localhost', 'localhost:3020', '127.0.0.1:3020', '[::1]:3020']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
  })

  it('does not accept a host that merely starts with a loopback name', () => {
    expect(isLoopbackHost('localhost.attacker.example')).toBe(false)
    expect(isLoopbackHost('127.0.0.1.attacker.example')).toBe(false)
  })
})

// 🔴 THE PERMISSION GRANT IS NARROWER THAN THE GATE, and these cells are the
// reason it is safe to touch server/lib/pdp at all. The gates say the PROCESS
// and the CALLER are local; this says the SUBJECT is the fictional reviewer.
// Without the subject check, a local server that somehow saw a real session
// would grant that real user every permission in the product.
describe('the permission grant', () => {
  it('allows the bypass user when the gates are open', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(isDevBypassSubject(eventWithHost('localhost:3020'), DEV_BYPASS_USER.id)).toBe(true)
  })

  it('refuses every other subject, gates open or not', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    for (const subject of [
      'a-real-central-auth-user-id',
      DEV_BYPASS_USER.id.toUpperCase(),
      `${DEV_BYPASS_USER.id}-2`,
      '',
      undefined,
    ]) {
      expect(isDevBypassSubject(eventWithHost('localhost:3020'), subject), String(subject)).toBe(
        false,
      )
    }
  })

  it('refuses the bypass user when any gate is closed', () => {
    process.env.NODE_ENV = 'production'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(isDevBypassSubject(eventWithHost('localhost:3020'), DEV_BYPASS_USER.id)).toBe(false)

    process.env.NODE_ENV = 'development'
    expect(isDevBypassSubject(eventWithHost('studio.grundtone.com'), DEV_BYPASS_USER.id)).toBe(
      false,
    )
  })
})

// 🔴 THE LEAK MUST BE LOUD. A bypass variable that reached a non-development
// build and was merely IGNORED would leave no trace: the deployment would look
// identical to one where it never escaped. The assertion below is what makes
// that case a failure instead of a silence, and the cells assert on the
// MESSAGE, because that is what a person reads at 03:00, not an exit code.
describe('the leak assertion', () => {
  it('refuses a non-development environment that carries the variable', () => {
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'production', STUDIO_DEV_AUTH_BYPASS: '1' }),
    ).toThrow(DEV_AUTH_BYPASS_MISCONFIGURED)
  })

  it('names the environment it found, so the message is actionable', () => {
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'staging', STUDIO_DEV_AUTH_BYPASS: '1' }),
    ).toThrow(/NODE_ENV=staging/)
  })

  it('refuses when NODE_ENV is unset entirely — the ambiguous case must not pass', () => {
    expect(() => assertBypassNotLeaked({ STUDIO_DEV_AUTH_BYPASS: '1' })).toThrow(/NODE_ENV=unset/)
  })

  it('refuses any truthy-looking value, not just the one that enables it', () => {
    // `true`, `yes` and `0` do not switch the bypass ON — but their presence in
    // a production environment file is the same accident, and pretending
    // otherwise would make the guard depend on the exact spelling someone used.
    for (const value of ['true', 'yes', '0', 'false']) {
      expect(() =>
        assertBypassNotLeaked({ NODE_ENV: 'production', STUDIO_DEV_AUTH_BYPASS: value }),
      ).toThrow(DEV_AUTH_BYPASS_MISCONFIGURED)
    }
  })

  // The other direction, and the one that keeps this from being a nuisance: an
  // environment without the variable must be silent.
  it('is silent when the variable is absent or empty', () => {
    expect(() => assertBypassNotLeaked({ NODE_ENV: 'production' })).not.toThrow()
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'production', STUDIO_DEV_AUTH_BYPASS: '' }),
    ).not.toThrow()
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'development', STUDIO_DEV_AUTH_BYPASS: '1' }),
    ).not.toThrow()
  })
})
