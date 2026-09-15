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

let deletedRow: Record<string, unknown> | null = null
let deletes = 0
vi.mock('~~/server/db', () => ({
  db: {
    delete: () => ({
      where: () => ({
        returning: () => {
          deletes += 1
          return Promise.resolve(deletedRow ? [deletedRow] : [])
        },
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  projectMember: {
    id: 'id',
    projectId: 'projectId',
    userId: 'userId',
    role: 'role',
    memberEmail: 'memberEmail',
  },
}))

const revokeProjectRole = vi.fn()
vi.mock('~~/server/lib/pdp', () => ({
  revokeProjectRole: (...args: unknown[]) => revokeProjectRole(...args),
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  PROJECT_ROLES: ['viewer', 'editor', 'admin'],
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const auditEvents: Array<{ action: string; payload: Record<string, unknown> }> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    auditEvents.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

const handler = (await import('./[memberId].delete')).default as unknown as (
  event: unknown,
) => Promise<{ id: string }>

const remove = () => handler(fakeEvent({ params: { projectId: PROJECT.id, memberId: 'm-1' } }))

beforeEach(() => {
  deletedRow = null
  deletes = 0
  auditEvents.length = 0
  revokeProjectRole.mockReset()
  revokeProjectRole.mockResolvedValue(undefined)
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'admin',
  })
})

describe('DELETE /api/projects/[projectId]/members/[memberId] — audit (riff mfhvuk8515gubxh30puab9ch)', () => {
  it('a removal writes exactly one project.member.removed after the PDP revoke', async () => {
    deletedRow = { id: 'm-1', userId: 'user-9', role: 'editor', memberEmail: 'member@example.com' }
    await expect(remove()).resolves.toEqual({ id: 'm-1' })

    expect(revokeProjectRole).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT.id,
      'user-9',
      'editor',
    )
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].payload).toMatchObject({
      organizationId: ORG.id,
      action: 'project.member.removed',
      targetId: PROJECT.id,
      targetLabel: PROJECT.name,
      after: { role: 'editor', memberEmail: 'member@example.com', memberUserId: 'user-9' },
    })
  })

  it('a failed PDP revoke fails the request and audits nothing', async () => {
    deletedRow = { id: 'm-1', userId: 'user-9', role: 'editor', memberEmail: 'member@example.com' }
    revokeProjectRole.mockRejectedValue(new Error('pdp down'))
    await expect(remove()).rejects.toThrow('pdp down')
    expect(auditEvents).toHaveLength(0)
  })

  it('an unknown member (404) audits nothing', async () => {
    await expect(remove()).rejects.toMatchObject({ statusCode: 404 })
    expect(auditEvents).toHaveLength(0)
  })

  it('a caller without admin access (403) deletes and audits nothing', async () => {
    requireProjectAccess.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 })
    expect(deletes).toBe(0)
    expect(auditEvents).toHaveLength(0)
  })
})
