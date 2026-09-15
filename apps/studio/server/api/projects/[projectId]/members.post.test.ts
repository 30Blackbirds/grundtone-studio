import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG, SESSION } from '~~/tests/helpers/endpoint-fixtures'

// members.post.ts relies on Nuxt auto-imports for these.
const h3 = mockH3()
vi.stubGlobal('defineEventHandler', h3.defineEventHandler)
vi.stubGlobal('getRouterParam', h3.getRouterParam)
vi.stubGlobal('readBody', h3.readBody)
vi.stubGlobal('createError', h3.createError)
vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: 'https://studio.test' } }))

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}))

const pending: Array<Record<string, unknown>> = []
const writes: Array<{ kind: 'insert' | 'update'; values: Record<string, unknown> }> = []
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(pending.slice(0, 1)) }) }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            writes.push({ kind: 'update', values: s })
            return Promise.resolve([{ ...pending[0], ...s }])
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          writes.push({ kind: 'insert', values: v })
          return Promise.resolve([{ id: 'inv-new', ...v }])
        },
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  projectInvitation: { id: 'id', projectId: 'projectId', email: 'email', status: 'status' },
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  PROJECT_ROLES: ['viewer', 'editor', 'admin'],
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const sendEmail = vi.fn()
vi.mock('~~/server/lib/email', () => ({ email: { send: (m: unknown) => sendEmail(m) } }))
vi.mock('~~/server/lib/email-templates', () => ({
  localeFromEvent: () => 'en',
  projectInviteEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))

const auditEvents: Array<{ action: string; payload: Record<string, unknown> }> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    auditEvents.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

const handler = (await import('./members.post')).default as unknown as (
  event: unknown,
) => Promise<{ id: string }>

const invite = (body: unknown) => handler(fakeEvent({ params: { projectId: PROJECT.id }, body }))

beforeEach(() => {
  pending.length = 0
  writes.length = 0
  auditEvents.length = 0
  sendEmail.mockReset()
  sendEmail.mockResolvedValue(undefined)
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'admin',
  })
})

describe('POST /api/projects/[projectId]/members — audit (riff mfhvuk8515gubxh30puab9ch)', () => {
  it('a new invitation writes exactly one project.member.invited', async () => {
    await invite({ email: 'new@example.com', role: 'editor' })

    expect(writes.map((w) => w.kind)).toEqual(['insert'])
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].payload).toMatchObject({
      organizationId: ORG.id,
      action: 'project.member.invited',
      targetType: 'project',
      targetId: PROJECT.id,
      targetLabel: PROJECT.name,
      after: {
        inviteeEmail: 'new@example.com',
        role: 'editor',
        reinvited: false,
        invitationId: 'inv-new',
      },
    })
  })

  it('refreshing a pending invitation is audited as reinvited', async () => {
    pending.push({
      id: 'inv-old',
      projectId: PROJECT.id,
      email: 'new@example.com',
      status: 'pending',
    })
    await invite({ email: 'new@example.com', role: 'admin' })

    expect(writes.map((w) => w.kind)).toEqual(['update'])
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].payload).toMatchObject({
      after: { role: 'admin', reinvited: true, invitationId: 'inv-old' },
    })
  })

  it('the invitation is still audited when sending the email fails', async () => {
    sendEmail.mockRejectedValue(new Error('smtp down'))
    await expect(invite({ email: 'new@example.com', role: 'viewer' })).rejects.toThrow('smtp down')

    expect(writes).toHaveLength(1)
    expect(auditEvents).toHaveLength(1)
  })

  it('an invalid body writes and audits nothing', async () => {
    await expect(invite({ email: 'not-an-email', role: 'editor' })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(writes).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  it('a caller without admin access writes and audits nothing', async () => {
    requireProjectAccess.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )
    await expect(invite({ email: 'new@example.com', role: 'editor' })).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(writes).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })
})
