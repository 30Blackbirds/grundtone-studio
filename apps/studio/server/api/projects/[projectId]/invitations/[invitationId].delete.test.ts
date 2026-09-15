import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG, SESSION } from '~~/tests/helpers/endpoint-fixtures'

// The route relies on Nuxt auto-imports for these.
const h3 = mockH3()
vi.stubGlobal('defineEventHandler', h3.defineEventHandler)
vi.stubGlobal('getRouterParam', h3.getRouterParam)
vi.stubGlobal('createError', h3.createError)

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}))

let cancelled: Record<string, unknown> | null = null
let updates = 0
vi.mock('~~/server/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            updates += 1
            return Promise.resolve(cancelled ? [cancelled] : [])
          },
        }),
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  projectInvitation: { id: 'id', projectId: 'projectId', email: 'email', role: 'role' },
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const auditEvents: Array<{ action: string; payload: Record<string, unknown> }> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    auditEvents.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

const handler = (await import('./[invitationId].delete')).default as unknown as (
  event: unknown,
) => Promise<{ id: string }>

const cancel = () =>
  handler(fakeEvent({ params: { projectId: PROJECT.id, invitationId: 'inv-1' } }))

beforeEach(() => {
  cancelled = null
  updates = 0
  auditEvents.length = 0
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'admin',
  })
})

describe('DELETE /api/projects/[projectId]/invitations/[invitationId] — audit (riff mfhvuk8515gubxh30puab9ch)', () => {
  it('a cancellation writes exactly one project.member.invite_cancelled', async () => {
    cancelled = { id: 'inv-1', email: 'invitee@example.com', role: 'editor' }
    await expect(cancel()).resolves.toEqual({ id: 'inv-1' })

    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].payload).toMatchObject({
      organizationId: ORG.id,
      action: 'project.member.invite_cancelled',
      targetId: PROJECT.id,
      targetLabel: PROJECT.name,
      after: { inviteeEmail: 'invitee@example.com', role: 'editor', invitationId: 'inv-1' },
    })
  })

  it('an unknown invitation (404) audits nothing', async () => {
    await expect(cancel()).rejects.toMatchObject({ statusCode: 404 })
    expect(auditEvents).toHaveLength(0)
  })

  it('a caller without admin access (403) updates and audits nothing', async () => {
    requireProjectAccess.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )
    await expect(cancel()).rejects.toMatchObject({ statusCode: 403 })
    expect(updates).toBe(0)
    expect(auditEvents).toHaveLength(0)
  })
})
