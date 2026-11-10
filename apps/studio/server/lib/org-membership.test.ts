import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// What studio's server sends to auth, where to, and how it reads the answer;
// and the up-front refusal when that is not configured. The order of the writes
// around it is in org-membership.pg.test.ts.

vi.mock('h3', () => mockH3())
vi.mock('./audit', () => ({ auditRow: () => ({}) }))
vi.mock('./metrics', () => ({ recordOrgWriteIncomplete: vi.fn() }))
vi.mock('./project-access', () => ({
  ORG_ROLES: ['billing', 'member', 'admin', 'manager', 'owner'],
  orgRoleHelpers: {},
}))

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const { authCaller, AuthOutcomeUnknown, AuthRefused, ORG_WRITE_CREDENTIAL_HEADER, orgWriteTarget } =
  await import('./org-membership')

const SECRET = 's'.repeat(32)
const target = { base: 'http://auth.internal', credential: SECRET }
const event = fakeEvent({
  headers: { cookie: 'session=abc', origin: 'https://studio.test', 'x-other': 'no' },
}) as never

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
})

describe('authCaller', () => {
  it('POSTs to the internal auth URL as the user: cookie, origin, credential, nothing else', async () => {
    await authCaller(event, target)('leave', { organizationId: 'org-1' })
    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://auth.internal/api/auth/organization/leave')
    expect(opts).toMatchObject({ method: 'POST', body: { organizationId: 'org-1' } })
    expect(opts.headers).toEqual({
      cookie: 'session=abc',
      origin: 'https://studio.test',
      [ORG_WRITE_CREDENTIAL_HEADER]: SECRET,
    })
  })

  it('a 4xx is auth deciding: AuthRefused, with the status', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('x'), { status: 403, data: { code: 'F' } }))
    const err = await authCaller(event, target)('leave', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AuthRefused)
    expect((err as InstanceType<typeof AuthRefused>).status).toBe(403)
  })

  // 🔴 Auth may have committed the write and lost the response: a 5xx must
  // never read as "nothing happened".
  it('a 5xx after auth may have committed is UNKNOWN, not a refusal', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('x'), { status: 502 }))
    await expect(authCaller(event, target)('leave', {})).rejects.toBeInstanceOf(AuthOutcomeUnknown)
  })

  it('no answer at all (network, timeout) is unknown', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(authCaller(event, target)('leave', {})).rejects.toBeInstanceOf(AuthOutcomeUnknown)
  })

  // The error that reaches logs carries a status, never the request's headers.
  it('the error it throws does not carry the credential', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error(`[POST] header ${SECRET}`), { status: 503 }),
    )
    const err = await authCaller(event, target)('leave', {}).catch((e: unknown) => e)
    expect(String((err as Error).message)).not.toContain(SECRET)
  })
})

describe('orgWriteTarget: refused up front, 503, before anything is written or asked', () => {
  const ok = { AUTH_INTERNAL_URL: 'http://auth.internal', ORG_WRITE_SERVICE_SECRET: SECRET }

  it('both set, the secret at least 32 bytes: the target', () => {
    expect(orgWriteTarget(ok)).toEqual(target)
  })

  it.each([
    ['the secret unset', { ...ok, ORG_WRITE_SERVICE_SECRET: undefined }],
    ['the secret empty', { ...ok, ORG_WRITE_SERVICE_SECRET: '' }],
    ['the secret 31 bytes', { ...ok, ORG_WRITE_SERVICE_SECRET: 's'.repeat(31) }],
    // 🔴 Never the public issuer: these calls go to the internal address only.
    [
      'no AUTH_INTERNAL_URL, even with AUTH_ISSUER set',
      {
        AUTH_ISSUER: 'https://auth.public',
        ORG_WRITE_SERVICE_SECRET: SECRET,
      },
    ],
  ])('%s → 503 org_write_unconfigured', (_name, env) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => orgWriteTarget(env as NodeJS.ProcessEnv)).toThrow(
      expect.objectContaining({ statusCode: 503, data: { code: 'org_write_unconfigured' } }),
    )
  })

  it('the refusal names what is missing and never the value', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const short = 'short-secret-value'
    expect(() => orgWriteTarget({ ...ok, ORG_WRITE_SERVICE_SECRET: short })).toThrow()
    const logged = log.mock.calls.flat().join(' ')
    expect(logged).toContain('ORG_WRITE_SERVICE_SECRET')
    expect(logged).not.toContain(short)
  })
})

// M1 (Sikkerhed): the credential header is not redacted the way Authorization
// and Cookie are, so in production it may only travel over https, or over
// plain http to a host that is not on the public internet.
describe('orgWriteTarget in production: where the credential may go', () => {
  const prod = { NODE_ENV: 'production', ORG_WRITE_SERVICE_SECRET: SECRET }

  it.each([
    ['https to a public host', 'https://auth.example.test'],
    ['http to loopback', 'http://127.0.0.1:3000'],
    ['http to a private address', 'http://10.11.0.10:3000'],
    ['http to a 172.16/12 address', 'http://172.20.0.5:3000'],
    ['http to a 192.168 address', 'http://192.168.1.4'],
    ['http to localhost', 'http://localhost:3000'],
    ['http to IPv6 loopback', 'http://[::1]:3000'],
  ])('%s: allowed', (_name, url) => {
    expect(orgWriteTarget({ ...prod, AUTH_INTERNAL_URL: url })).toMatchObject({ base: url })
  })

  it.each([
    ['http to a public host', 'http://auth.example.test'],
    // C3: public names that only START like a private range.
    ['http://10.evil.example:3000', 'http://10.evil.example:3000'],
    ['http://127.attacker.example', 'http://127.attacker.example'],
    ['http://192.168.evil.example', 'http://192.168.evil.example'],
    ['http://172.16.x.example', 'http://172.16.x.example'],
    // A single-label name resolves via search domains and can be public.
    ['http://evil', 'http://evil'],
    ['http to a container service name', 'http://auth:3000'],
    ['http to a public IPv6 address', 'http://[2001:db8::1]'],
    ['http to a public address', 'http://8.8.8.8'],
    ['http to 172.32 (outside 172.16/12)', 'http://172.32.0.1'],
    ['not a URL', 'auth:3000'],
    ['another scheme', 'ftp://auth.example.test'],
  ])('%s: 503 org_write_unconfigured', (_name, url) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => orgWriteTarget({ ...prod, AUTH_INTERNAL_URL: url })).toThrow(
      expect.objectContaining({ statusCode: 503, data: { code: 'org_write_unconfigured' } }),
    )
  })

  it('outside production, http to any host is allowed (local stacks)', () => {
    expect(
      orgWriteTarget({
        ORG_WRITE_SERVICE_SECRET: SECRET,
        AUTH_INTERNAL_URL: 'http://auth.example.test',
      }),
    ).toMatchObject({ base: 'http://auth.example.test' })
  })

  it('certificate checks turned off (NODE_TLS_REJECT_UNAUTHORIZED=0): 503, in any environment', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const env of [prod, {}]) {
      expect(() =>
        orgWriteTarget({
          ...env,
          ORG_WRITE_SERVICE_SECRET: SECRET,
          AUTH_INTERNAL_URL: 'https://auth.example.test',
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        }),
      ).toThrow(expect.objectContaining({ statusCode: 503 }))
    }
  })
})
