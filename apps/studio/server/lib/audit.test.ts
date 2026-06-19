import { describe, it, expect, vi, beforeEach } from 'vitest'

// The helper writes to one table and optionally reads the H3 session. We stub
// both, capturing every insert so the test can assert the row shape.

const inserts: Array<Record<string, unknown>> = []

vi.mock('../db', () => {
  const insert = () => ({
    values: (row: Record<string, unknown>) => {
      inserts.push(row)
      return Promise.resolve()
    },
  })
  return { db: { insert } }
})
vi.mock('../db/schema', () => ({ auditLog: {} }))

const getSession = vi.fn()
vi.mock('./auth', () => ({ auth: { api: { getSession } } }))

// h3 is a transitive dep via Nuxt — vitest's resolver can't find it directly.
// Stub the helpers we use so the test runs standalone.
vi.mock('h3', () => ({
  getRequestIP: (event: { node?: { req?: { headers?: Record<string, string> } } }) =>
    event?.node?.req?.headers?.['x-forwarded-for'] ?? null,
  getRequestHeader: (
    event: { node?: { req?: { headers?: Record<string, string> } } },
    name: string,
  ) => event?.node?.req?.headers?.[name.toLowerCase()] ?? null,
}))

const { recordAuditEvent } = await import('./audit')

const ORG_ID = 'org-1'
const ACTOR = { id: 'user-1', email: 'allan@example.com' }

describe('recordAuditEvent', () => {
  beforeEach(() => {
    inserts.length = 0
    getSession.mockReset()
  })

  it('persists a minimal event with no event handle', async () => {
    await recordAuditEvent(null, {
      organizationId: ORG_ID,
      action: 'project.created',
      targetType: 'project',
      targetId: 'p1',
      targetLabel: 'Greenbow',
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      organizationId: ORG_ID,
      action: 'project.created',
      targetType: 'project',
      targetId: 'p1',
      targetLabel: 'Greenbow',
      actorUserId: null,
      actorEmail: null,
      ipAddress: null,
      userAgent: null,
    })
  })

  it('captures actor + IP + UA from the H3 event when present', async () => {
    getSession.mockResolvedValue({ user: ACTOR })
    // Minimal H3-like event with the headers proxy and node primitives the
    // helper accesses. getRequestIP/getRequestHeader read from event.node.req.
    const fakeEvent = {
      headers: new Headers(),
      node: {
        req: {
          headers: {
            'x-forwarded-for': '203.0.113.7',
            'user-agent': 'curl/7.88',
          },
          socket: { remoteAddress: '127.0.0.1' },
        },
      },
    } as unknown as Parameters<typeof recordAuditEvent>[0]
    await recordAuditEvent(fakeEvent, {
      organizationId: ORG_ID,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: 'k1',
    })
    expect(inserts[0]).toMatchObject({
      organizationId: ORG_ID,
      action: 'api_key.created',
      actorUserId: ACTOR.id,
      actorEmail: ACTOR.email,
      ipAddress: '203.0.113.7',
      userAgent: 'curl/7.88',
    })
  })

  it('explicit actor fields win over session-derived ones', async () => {
    getSession.mockResolvedValue({ user: ACTOR })
    const fakeEvent = {
      headers: new Headers(),
      node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
    } as unknown as Parameters<typeof recordAuditEvent>[0]
    await recordAuditEvent(fakeEvent, {
      organizationId: ORG_ID,
      action: 'member.invited',
      actorUserId: 'system-1',
      actorEmail: 'system@grundtone.com',
    })
    expect(inserts[0]).toMatchObject({
      actorUserId: 'system-1',
      actorEmail: 'system@grundtone.com',
    })
  })

  it('swallows insert failures so audit cannot break the underlying mutation', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Force the insert to throw by mutating the inserts array's push.
    const originalPush = inserts.push.bind(inserts)
    inserts.push = () => {
      throw new Error('boom')
    }
    await expect(
      recordAuditEvent(null, { organizationId: ORG_ID, action: 'project.created' }),
    ).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    inserts.push = originalPush
    errSpy.mockRestore()
  })

  it('does not call getSession when actor fields are already supplied', async () => {
    const fakeEvent = {
      headers: new Headers(),
      node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
    } as unknown as Parameters<typeof recordAuditEvent>[0]
    await recordAuditEvent(fakeEvent, {
      organizationId: ORG_ID,
      action: 'member.role_changed',
      actorUserId: 'pre-known',
      actorEmail: 'pre-known@example.com',
    })
    expect(getSession).not.toHaveBeenCalled()
  })
})
