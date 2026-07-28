import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

const selectResults: unknown[] = []
const resetSpy = vi.fn()
let checkOk = true

vi.mock('h3', () => mockH3())

vi.mock('~~/server/db', () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => Promise.resolve(selectResults.shift() ?? []),
      }
      return chain
    },
  },
}))

vi.mock('~~/server/db/schema', () => ({
  projectMember: { projectId: 'projectId', userId: 'userId' },
  project: { id: 'id', name: 'name', slug: 'slug', organizationId: 'organizationId' },
  apiKey: { createdBy: 'createdBy' },
  configVersion: { publishedBy: 'publishedBy' },
  activeVersion: { activatedBy: 'activatedBy' },
  auditLog: { actorUserId: 'actorUserId' },
  projectInvitation: { invitedBy: 'invitedBy' },
}))

vi.mock('~~/server/lib/rate-limit', () => ({
  SlidingWindowRateLimiter: class {
    check() {
      return { ok: checkOk, remaining: 0, resetAt: Date.now() + 3600000 }
    }
    reset(key: string) {
      resetSpy(key)
    }
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', (...args: unknown[]) => fetchMock(...args))

const handler = (await import('./export.get')).default as unknown as (
  event: ReturnType<typeof fakeEvent>,
) => Promise<Record<string, unknown>>

const authedEvent = () =>
  fakeEvent({ context: { auth: { sub: 'user-1', tenant: 'org-1', email: 'a@b.dk' } } })

describe('GET /api/account/export', () => {
  beforeEach(() => {
    selectResults.length = 0
    for (let i = 0; i < 6; i++) selectResults.push([])
    resetSpy.mockReset()
    fetchMock.mockReset()
    checkOk = true
    vi.unstubAllEnvs()
  })

  it('401s without auth', async () => {
    await expect(handler(fakeEvent({ context: {} }))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('429s when the rate limit is exceeded', async () => {
    checkOk = false
    await expect(handler(authedEvent())).rejects.toMatchObject({ statusCode: 429 })
  })

  it('joins identity + studio data and keeps the rate-limit slot when complete', async () => {
    vi.stubEnv('AUTH_INTERNAL_URL', 'http://auth:3000')
    vi.stubEnv('IDENTITY_EXPORT_SERVICE_SECRET', 'sekret')
    fetchMock.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'a@b.dk' },
      accounts: [],
      organizations: [{ organizationId: 'org-1', name: 'Acme', role: 'owner', createdAt: 'x' }],
      sessions: [],
    })

    const event = authedEvent()
    const res = await handler(event)

    expect(res.userId).toBe('user-1')
    expect(res.complete).toBe(true)
    expect((res.studio as Record<string, unknown>).email).toBe('a@b.dk')
    expect(res.studio).toHaveProperty('projectMemberships')
    expect(res.identity).toMatchObject({ organizations: [{ name: 'Acme' }] })
    // Complete export → the once-per-hour slot stays consumed.
    expect(resetSpy).not.toHaveBeenCalled()
    // s2s call carried the bearer secret + userId.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://auth:3000/api/auth/identity-export',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sekret' }),
        body: { userId: 'user-1' },
      }),
    )
    expect(event.responseHeaders['content-type']).toBe('application/json')
  })

  it('soft-fails identity + refunds the slot when auth is not configured', async () => {
    // No AUTH_INTERNAL_URL / secret → fetchIdentityExport returns the marker
    // without ever calling out.
    const res = await handler(authedEvent())

    expect(res.complete).toBe(false)
    expect(res.identity).toMatchObject({
      error: 'identity_temporarily_unavailable',
      retryable: true,
    })
    // Studio data is still fully present — art.20 isn't blocked.
    expect(res.studio).toHaveProperty('projectMemberships')
    // Incomplete export must not burn the user's slot.
    expect(resetSpy).toHaveBeenCalledWith('account-export:user-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('soft-fails identity + refunds the slot when the auth call throws', async () => {
    vi.stubEnv('AUTH_INTERNAL_URL', 'http://auth:3000')
    vi.stubEnv('IDENTITY_EXPORT_SERVICE_SECRET', 'sekret')
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const res = await handler(authedEvent())

    expect(res.complete).toBe(false)
    expect(res.identity).toMatchObject({ error: 'identity_temporarily_unavailable' })
    expect(resetSpy).toHaveBeenCalledWith('account-export:user-1')
  })
})
