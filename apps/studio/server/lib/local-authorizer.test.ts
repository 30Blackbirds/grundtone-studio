import { beforeEach, describe, expect, it, vi } from 'vitest'

// The rule matrix of the local authorizer, without a database. The real
// Postgres half is local-authorizer.pg.test.ts.

let dbImpl: () => Promise<unknown> = async () => []
const chain = () => {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'leftJoin', 'where']) c[m] = () => c
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => dbImpl().then(res, rej)
  return c
}
vi.mock('../db', () => ({ db: { select: () => chain() } }))
vi.mock('./dev-auth-bypass', () => ({
  isDevBypassSubject: (_e: unknown, sub: string) => sub === 'dev-bypass',
}))

const { projectAllows, machineAllows, localAuthorizer } = await import('./local-authorizer')

const event = (sub: string | null) =>
  ({ context: { auth: sub ? { sub, tenant: 'org-1' } : undefined } }) as never
const P = '00000000-0000-4000-8000-000000000001'

describe('projectAllows: the permissions model, copied', () => {
  // [orgRole, projectRole, can_view, can_edit, can_admin]
  it.each([
    [null, null, false, false, false],
    ['owner', null, true, true, true],
    ['manager', null, true, true, true],
    // Org admin and member map to VIEWER, never to editor (model comment).
    ['admin', null, true, false, false],
    ['member', null, true, false, false],
    // 🔴 Billing gets no project access at all.
    ['billing', null, false, false, false],
    [null, 'viewer', true, false, false],
    [null, 'editor', true, true, false],
    [null, 'admin', true, true, true],
    // max(org, project): a direct grant lifts a lower org role…
    ['member', 'editor', true, true, false],
    ['billing', 'admin', true, true, true],
    // …and a lower direct grant does not lower a higher org role.
    ['owner', 'viewer', true, true, true],
  ] as const)('org %s + project %s', (orgRole, projectRole, view, edit, admin) => {
    const g = { orgRole, projectRole }
    expect(projectAllows(g, 'can_view')).toBe(view)
    expect(projectAllows(g, 'can_edit')).toBe(edit)
    expect(projectAllows(g, 'can_admin')).toBe(admin)
  })
})

describe('machineAllows', () => {
  it('a granted key can view and edit, and never admin', () => {
    expect(machineAllows(true, 'can_view')).toBe(true)
    expect(machineAllows(true, 'can_edit')).toBe(true)
    expect(machineAllows(true, 'can_admin')).toBe(false)
  })

  it('an ungranted key can do nothing', () => {
    expect(machineAllows(false, 'can_view')).toBe(false)
  })
})

describe('three outcomes, like pdp.ts', () => {
  beforeEach(() => {
    dbImpl = async () => []
  })

  it('no actor is denied, without asking the database', async () => {
    dbImpl = async () => {
      throw new Error('must not be called')
    }
    await expect(localAuthorizer.checkProject(event(null), P, 'can_view')).resolves.toBe('denied')
    await expect(localAuthorizer.checkOrg(event(null), 'org-1', 'owner')).resolves.toBe('denied')
  })

  // 🔴 An outage must read as `unavailable` (503), never as "no access" and
  // never as access.
  it('a database error is unavailable on every read', async () => {
    dbImpl = async () => {
      throw new Error('connection refused')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(localAuthorizer.checkProject(event('u1'), P, 'can_view')).resolves.toBe(
      'unavailable',
    )
    await expect(localAuthorizer.checkOrg(event('u1'), 'org-1', 'owner')).resolves.toBe(
      'unavailable',
    )
    await expect(
      localAuthorizer.batchCheckProjects(event('u1'), [P, 'not-a-uuid'], 'can_view'),
    ).resolves.toEqual({ [P]: 'unavailable', 'not-a-uuid': 'unavailable' })
  })

  it('checkOrg is an exact relation: owner does not pass a manager check', async () => {
    dbImpl = async () => [{ role: 'owner' }]
    await expect(localAuthorizer.checkOrg(event('u1'), 'org-1', 'owner')).resolves.toBe('allowed')
    await expect(localAuthorizer.checkOrg(event('u1'), 'org-1', 'manager')).resolves.toBe('denied')
  })

  it('a machine key never holds an org role', async () => {
    dbImpl = async () => [{ role: 'owner' }]
    await expect(localAuthorizer.checkOrg(event('machine:k1'), 'org-1', 'owner')).resolves.toBe(
      'denied',
    )
  })

  it('a malformed project id is denied, not an outage', async () => {
    dbImpl = async () => {
      throw new Error('invalid input syntax for type uuid')
    }
    await expect(localAuthorizer.checkProject(event('u1'), 'nope', 'can_view')).resolves.toBe(
      'denied',
    )
  })

  it('the dev bypass subject is allowed, as in pdp.ts', async () => {
    await expect(localAuthorizer.checkProject(event('dev-bypass'), P, 'can_admin')).resolves.toBe(
      'allowed',
    )
  })
})
