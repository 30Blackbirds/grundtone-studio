import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// authCaller: what studio's server sends to auth, and how it reads the answer.
// The order of the writes around it is in org-membership.pg.test.ts.

vi.mock('h3', () => mockH3())
vi.mock('./org-lookup', () => ({ authBase: () => 'http://auth.test' }))
vi.mock('./audit', () => ({ auditRow: () => ({}) }))
vi.mock('./project-access', () => ({
  ORG_ROLES: ['billing', 'member', 'admin', 'manager', 'owner'],
  orgRoleHelpers: {},
}))

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const { authCaller, AuthOutcomeUnknown, AuthRefused, ORG_WRITE_CREDENTIAL_HEADER } =
  await import('./org-membership')

const event = fakeEvent({
  headers: { cookie: 'session=abc', origin: 'https://studio.test', 'x-other': 'no' },
}) as never

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('authCaller', () => {
  it('POSTs to auth’s organization path as the user: cookie and origin, nothing else', async () => {
    vi.stubEnv('ORG_WRITE_SERVICE_SECRET', '')
    await authCaller(event)('leave', { organizationId: 'org-1' })
    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://auth.test/api/auth/organization/leave')
    expect(opts).toMatchObject({ method: 'POST', body: { organizationId: 'org-1' } })
    expect(opts.headers).toEqual({ cookie: 'session=abc', origin: 'https://studio.test' })
  })

  it('attaches the org-write credential when the secret is set', async () => {
    vi.stubEnv('ORG_WRITE_SERVICE_SECRET', 'test-value')
    await authCaller(event)('leave', { organizationId: 'org-1' })
    expect(fetchMock.mock.calls[0]![1].headers[ORG_WRITE_CREDENTIAL_HEADER]).toBe('test-value')
  })

  it('sends no credential header when the secret is unset', async () => {
    vi.stubEnv('ORG_WRITE_SERVICE_SECRET', '')
    await authCaller(event)('leave', { organizationId: 'org-1' })
    expect(Object.keys(fetchMock.mock.calls[0]![1].headers)).not.toContain(
      ORG_WRITE_CREDENTIAL_HEADER,
    )
  })

  it('a 4xx is auth deciding: AuthRefused, with the status', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('x'), { status: 403, data: { code: 'F' } }))
    const err = await authCaller(event)('leave', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AuthRefused)
    expect((err as InstanceType<typeof AuthRefused>).status).toBe(403)
  })

  // 🔴 Auth may have committed the write and lost the response: a 5xx must
  // never read as "nothing happened".
  it('a 5xx after auth may have committed is UNKNOWN, not a refusal', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('x'), { status: 502 }))
    await expect(authCaller(event)('leave', {})).rejects.toBeInstanceOf(AuthOutcomeUnknown)
  })

  it('no answer at all (network, timeout) is unknown', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(authCaller(event)('leave', {})).rejects.toBeInstanceOf(AuthOutcomeUnknown)
  })
})
