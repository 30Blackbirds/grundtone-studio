import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  DEV_AUTH_STUB_ROUTES,
  NEVER_STUB_AUTH_PATHS,
  STUBBABLE_AUTH_PATHS,
  stubKeyFor,
  unstubbedGroup,
} from './dev-auth-stub'

// 🔴 THE DENOMINATOR MUST STOP GROWING SILENTLY.
//
// On 2026-09-20 someone counted once: 28 auth paths called by studio, 6
// answered by the bypass stub, 22 answering 501, 18 of those reachable by
// clicking. A count is a snapshot; the moment anyone adds a call, the snapshot
// is wrong and nobody is told. That is the difference between having counted
// and continuing to count, and it is why this file exists ([sikkerhed],
// [projektleder]).
//
// WHAT IT READS AND THEREFORE WHAT IT CANNOT SEE: it greps the app sources for
// auth-client call shapes. It does not run studio, so a call built from a
// variable (`organization[method]()`) is invisible to it, and a local helper
// that happens to be named `updateUser` would be a false RED. A false red here
// is loud and costs one line to resolve; a false green would restore exactly
// the silence this guard exists to end.

const APP_DIRS = ['pages', 'components', 'composables', 'layouts', 'middleware', 'lib']

function sourceFiles(): string[] {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|vue)$/.test(entry) && !entry.includes('.test.')) out.push(full)
    }
  }
  for (const d of APP_DIRS) walk(join(root, d))
  return out
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** Core methods destructured from the auth client, and the path each hits. */
const CORE_METHODS: Record<string, string> = {
  signOut: 'sign-out',
  getSession: 'get-session',
  useSession: 'get-session',
  changeEmail: 'change-email',
  changePassword: 'change-password',
  updateUser: 'update-user',
  deleteUser: 'delete-user',
  requestPasswordReset: 'request-password-reset',
  resetPassword: 'reset-password',
  sendVerificationEmail: 'send-verification-email',
}

function calledAuthPaths(): Set<string> {
  const paths = new Set<string>()
  for (const file of sourceFiles()) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\borganization\.(\w+)\s*\(/g)) {
      paths.add(`organization/${kebab(m[1]!)}`)
    }
    for (const m of src.matchAll(/\bsignIn\.(\w+)\s*\(/g)) paths.add(`sign-in/${kebab(m[1]!)}`)
    for (const m of src.matchAll(/\bsignUp\.(\w+)\s*\(/g)) paths.add(`sign-up/${kebab(m[1]!)}`)
    for (const [method, path] of Object.entries(CORE_METHODS)) {
      if (new RegExp(`\\b${method}\\s*\\(`).test(src)) paths.add(path)
    }
  }
  return paths
}

describe('every auth path studio calls has a decided answer', () => {
  it('finds call sites at all (the denominator is not zero)', () => {
    const called = calledAuthPaths()
    expect(sourceFiles().length, 'no app sources scanned — the reader is broken').toBeGreaterThan(
      50,
    )
    expect(called.size, 'no auth call sites found — the patterns are broken').toBeGreaterThan(20)
  })

  it('no called path is missing from the stub, the never-stub list and the stubbable list', () => {
    const decided = new Set([
      ...Object.keys(DEV_AUTH_STUB_ROUTES),
      ...NEVER_STUB_AUTH_PATHS,
      ...STUBBABLE_AUTH_PATHS,
    ])
    const undecided = [...calledAuthPaths()].filter((p) => !decided.has(p)).sort()

    expect(
      undecided,
      `studio calls ${undecided.length} auth path(s) the bypass has no decision for: ` +
        `${undecided.join(', ')}. Add each to DEV_AUTH_STUB_ROUTES (answer it), ` +
        `NEVER_STUB_AUTH_PATHS (it changes a session, a right or an invitation) or ` +
        `STUBBABLE_AUTH_PATHS (display only, stub on request).`,
    ).toEqual([])
  })

  it('the stubbable list is still a measurement, not a leftover', () => {
    // Only this list is checked for staleness. NEVER_STUB is a POLICY and may
    // name a path nobody calls today; STUBBABLE claims "studio calls this and
    // it would be safe to stub", which stops being true if the call goes away.
    const called = calledAuthPaths()
    const stale = STUBBABLE_AUTH_PATHS.filter((p) => !called.has(p))
    expect(
      stale,
      `no longer called, so remove from STUBBABLE_AUTH_PATHS: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('answered paths are not also listed as unanswered (control)', () => {
    const answered = Object.keys(DEV_AUTH_STUB_ROUTES)
    const both = answered.filter(
      (p) => NEVER_STUB_AUTH_PATHS.includes(p) || STUBBABLE_AUTH_PATHS.includes(p),
    )
    expect(both, `listed as both answered and unanswered: ${both.join(', ')}`).toEqual([])
  })
})

describe('the group a caller is told about', () => {
  it('calls session, rights and invitation changes "never"', () => {
    for (const p of ['sign-out', 'organization/invite-member', 'organization/remove-member']) {
      expect(unstubbedGroup(p), p).toBe('never')
    }
  })

  it('calls a display-only gap "on-request"', () => {
    expect(unstubbedGroup('organization/update')).toBe('on-request')
  })

  // Creating an org makes the caller its owner: a right, never stubbed.
  it('org creation is "never"', () => {
    expect(unstubbedGroup('organization/create')).toBe('never')
  })

  it('maps a request path to its stub key', () => {
    expect(stubKeyFor('/api/auth/organization/list?organizationId=x')).toBe('organization/list')
  })
})
