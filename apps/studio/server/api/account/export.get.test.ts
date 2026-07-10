import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

const selectResults: unknown[] = []

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
      return { ok: true, remaining: 0, resetAt: Date.now() + 3600000 }
    }
  },
}))

const handler = (await import('./export.get')).default as unknown as (
  event: ReturnType<typeof fakeEvent>,
) => Promise<Record<string, unknown>>

describe('GET /api/account/export', () => {
  beforeEach(() => {
    selectResults.length = 0
    for (let i = 0; i < 6; i++) selectResults.push([])
  })

  it('401s without auth', async () => {
    await expect(handler(fakeEvent({ context: {} }))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns export payload for authenticated user', async () => {
    const event = fakeEvent({
      context: { auth: { sub: 'user-1', tenant: 'org-1', email: 'a@b.dk' } },
    })
    const res = await handler(event)
    expect(res.userId).toBe('user-1')
    expect(res.email).toBe('a@b.dk')
    expect(res).toHaveProperty('exportedAt')
    expect(res).toHaveProperty('projectMemberships')
    expect(event.responseHeaders['content-type']).toBe('application/json')
  })
})
