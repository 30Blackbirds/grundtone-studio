import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)
const { orgWrites } = await import('./org-writes')

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
})

describe('orgWrites: each write goes to studio’s route', () => {
  it.each([
    [
      'create',
      () => orgWrites.create({ name: 'A', slug: 'a' }),
      '/api/orgs',
      'POST',
      { name: 'A', slug: 'a' },
    ],
    ['delete', () => orgWrites.delete('o 1'), '/api/orgs/o%201', 'DELETE', undefined],
    [
      'invite',
      () => orgWrites.inviteMember('o1', { email: 'e@x.test', role: 'member', resend: true }),
      '/api/orgs/o1/invitations',
      'POST',
      { email: 'e@x.test', role: 'member', resend: true },
    ],
    [
      'accept',
      () => orgWrites.acceptInvitation('i1'),
      '/api/org-invitations/i1/accept',
      'POST',
      undefined,
    ],
    [
      'role',
      () => orgWrites.updateMemberRole('o1', 'm1', 'admin'),
      '/api/orgs/o1/memberships/m1',
      'PATCH',
      { role: 'admin' },
    ],
    [
      'remove',
      () => orgWrites.removeMember('o1', 'm1'),
      '/api/orgs/o1/memberships/m1',
      'DELETE',
      undefined,
    ],
    ['leave', () => orgWrites.leave('o1'), '/api/orgs/o1/leave', 'POST', undefined],
  ] as const)('%s', async (_n, run, url, method, body) => {
    const res = await run()
    expect(res).toEqual({ data: { ok: true }, error: null })
    const [u, opts] = fetchMock.mock.calls[0]!
    expect(u).toBe(url)
    expect(opts.method).toBe(method)
    expect(opts.body).toEqual(body)
  })

  it('a refusal comes back as { error } with the route’s message and code, not a throw', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('x'), {
        statusCode: 503,
        data: { statusMessage: 'Not configured', data: { code: 'org_write_unconfigured' } },
      }),
    )
    expect(await orgWrites.leave('o1')).toEqual({
      data: null,
      error: { status: 503, message: 'Not configured', code: 'org_write_unconfigured' },
    })
  })
})

// 🔴 A TRIPWIRE: a page that writes org membership straight to auth's client
// would go around studio's record of org roles. Measured 9 such calls before
// this change and 0 after; this cell keeps it 0, and names the file if not.
describe('no page or component writes org membership to auth directly', () => {
  const ROOT = join(import.meta.dirname, '..')
  const WRITE =
    /organization\.(create|delete|inviteMember|acceptInvitation|removeMember|updateMemberRole|leave)\(/

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) return walk(p)
      return /\.(vue|ts)$/.test(e) && !e.endsWith('.test.ts') ? [p] : []
    })
  }

  it('finds the files it scans at all (denominator)', () => {
    expect(
      walk(join(ROOT, 'pages')).length + walk(join(ROOT, 'components')).length,
    ).toBeGreaterThan(20)
  })

  it('0 direct writes in pages/, components/ and composables/', () => {
    const hits = ['pages', 'components', 'composables']
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((p) => WRITE.test(readFileSync(p, 'utf8')))
      .map((p) => p.replace(ROOT, ''))
    expect(hits).toEqual([])
  })
})
