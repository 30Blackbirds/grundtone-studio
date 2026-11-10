import { describe, expect, it } from 'vitest'
import * as client from '~~/composables/useOrgRoles'
import {
  ASSIGNABLE,
  assertSameOrigin,
  canAssignRole,
  canManageMember,
  ORG_RANK,
} from './org-membership-input'

// The server's copy of the members page's role rules must give the same answer
// for every pair, or the page offers what the server refuses (or the reverse).
describe('org role rules: server and members page agree', () => {
  it('the same rank order', () => {
    expect(ORG_RANK).toEqual(client.ORG_ROLES)
  })

  it('the same assignable roles', () => {
    expect([...ASSIGNABLE].sort()).toEqual([...client.ASSIGNABLE_ORG_ROLES].sort())
  })

  const pairs = ORG_RANK.flatMap((a) => ORG_RANK.map((b) => [a, b] as const))
  it.each(pairs)('actor %s, target %s', (actor, target) => {
    expect(canAssignRole(actor, target)).toBe(client.canAssignRole(actor, target))
    expect(canManageMember(actor, target)).toBe(client.canManageMember(actor, target))
  })

  it('a manager cannot make anyone a manager, and cannot touch another manager', () => {
    expect(canAssignRole('manager', 'manager')).toBe(false)
    expect(canManageMember('manager', 'manager')).toBe(false)
    expect(canManageMember('owner', 'owner')).toBe(true)
  })
})

describe('assertSameOrigin', () => {
  const ev = (headers: Record<string, string>) => ({ node: { req: { headers } } }) as never
  const refused = { statusCode: 403, data: { code: 'cross_origin' } }

  it('same origin as the host it was sent to: allowed', () => {
    expect(() =>
      assertSameOrigin(ev({ origin: 'https://studio.test', host: 'studio.test' }), ''),
    ).not.toThrow()
  })

  it('the configured app URL is allowed when the host differs (behind a proxy)', () => {
    expect(() =>
      assertSameOrigin(
        ev({ origin: 'https://studio.test', host: 'studio:3000' }),
        'https://studio.test',
      ),
    ).not.toThrow()
  })

  it.each([
    ['another origin', { origin: 'https://evil.test', host: 'studio.test' }],
    ['the same host on another port', { origin: 'https://studio.test:9999', host: 'studio.test' }],
    ['no Origin', { host: 'studio.test' }],
    ['an Origin that is not a URL', { origin: 'null', host: 'studio.test' }],
    [
      'Sec-Fetch-Site says cross-site',
      { origin: 'https://studio.test', host: 'studio.test', 'sec-fetch-site': 'cross-site' },
    ],
    [
      'Sec-Fetch-Site says same-site',
      { origin: 'https://studio.test', host: 'studio.test', 'sec-fetch-site': 'same-site' },
    ],
  ])('%s: 403 cross_origin', (_name, headers) => {
    expect(() => assertSameOrigin(ev(headers), '')).toThrow(expect.objectContaining(refused))
  })
})
