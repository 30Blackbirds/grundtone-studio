import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Same standalone harness as accept.test.ts: inline db mock og delt h3-mock,
// identity on event.context.auth. Decline has no PDP grant and no transaction
// — it only flips the invitation status, so the mock surface is smaller.
interface FakeEvent {
  params: Record<string, string>
  context: { auth?: { sub: string; tenant: string; email: string } }
}
function fakeEvent(
  opts: {
    params?: Record<string, string>
    auth?: { sub: string; tenant: string; email: string }
  } = {},
): FakeEvent {
  return {
    params: { ...(opts.params ?? {}) },
    context: opts.auth ? { auth: opts.auth } : {},
  }
}
// Som i accept.test.ts: h3-mocken kommer fra tests/helpers/endpoint-fixtures.
// Den lokale `function mockH3()` der stod her, skyggede for den delte helper
// af samme navn og tabte statusMessage. Handleren læser kun getRouterParam og
// createError, som begge findes i den delte mock.

interface InviteRow {
  id: string
  projectId: string
  email: string
  role: string
  status: string
  invitedBy: string
  expiresAt: Date
}

const invites: InviteRow[] = []
const statusUpdates: Array<{ status: string }> = []

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({ eq: (_col: unknown, value: string) => ({ value }) }))

const dbMock = {
  select: () => ({
    from: (table: { _?: { name?: string } } | undefined) => ({
      where: (predicate: { value?: string } | null) =>
        table?._?.name === 'project'
          ? Promise.resolve(projects.filter((p) => p.id === (predicate?.value ?? null)))
          : Promise.resolve(invites.filter((inv) => inv.id === (predicate?.value ?? null))),
    }),
  }),
  update: () => ({
    set: (s: { status: string }) => ({
      where: () => {
        statusUpdates.push({ status: s.status })
        return Promise.resolve()
      },
    }),
  }),
}
vi.mock('~~/server/db', () => ({ db: dbMock }))
vi.mock('~~/server/db/schema', () => ({
  project: { _: { name: 'project' }, id: 'id', organizationId: 'organizationId', name: 'name' },
  projectInvitation: { _: { name: 'project_invitation' }, id: 'id' },
}))
const auditEvents: Array<{ action: string; payload: Record<string, unknown> }> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    auditEvents.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))
const projects = [{ id: 'p1', organizationId: 'org-acme', name: 'Acme Brand' }]

const handler = (await import('./decline.post')).default as unknown as (
  event: unknown,
) => Promise<unknown>

const INVITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function freshInvite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: INVITE_ID,
    projectId: 'p1',
    email: 'invitee@example.com',
    role: 'editor',
    status: 'pending',
    invitedBy: 'inviter',
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  }
}

beforeEach(() => {
  invites.length = 0
  statusUpdates.length = 0
  auditEvents.length = 0
})

describe('POST /api/invitations/project/[invitationId]/decline', () => {
  it('401 without a signed-in identity', async () => {
    invites.push(freshInvite())
    await expect(handler(fakeEvent({ params: { invitationId: INVITE_ID } }))).rejects.toMatchObject(
      { statusCode: 401 },
    )
  })

  it('403 when the caller email does not match the invitee', async () => {
    invites.push(freshInvite())
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: INVITE_ID },
          auth: { sub: 'u1', tenant: 'o1', email: 'someone-else@example.com' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(statusUpdates).toHaveLength(0)
  })

  it('409 when the invitation is not pending', async () => {
    invites.push(freshInvite({ status: 'accepted' }))
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: INVITE_ID },
          auth: { sub: 'u1', tenant: 'o1', email: 'invitee@example.com' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('declines a pending invitation for the addressed email (case-insensitive)', async () => {
    invites.push(freshInvite())
    const res = await handler(
      fakeEvent({
        params: { invitationId: INVITE_ID },
        auth: { sub: 'u1', tenant: 'o1', email: 'INVITEE@example.com' },
      }),
    )
    expect(res).toEqual({ declined: true })
    expect(statusUpdates).toEqual([{ status: 'declined' }])
  })

  // 🔴 LÅSER at fejlbeskeden kan asserteres — se
  // server/api/account/deleted.post.test.ts for den fulde begrundelse. Også
  // denne fil bar en lokal `function mockH3()`, der skyggede for den delte
  // helper af samme navn; den er nu fjernet til fordel for importen.
  it('bærer 409-beskeden frem med invitationens faktiske status', async () => {
    invites.push(freshInvite({ status: 'accepted' }))
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: INVITE_ID },
          auth: { sub: 'u1', tenant: 'o1', email: 'invitee@example.com' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Invitation is accepted' })
  })

  it('bærer 403-beskeden frem, så afvisningsgrunden er pinnet', async () => {
    invites.push(freshInvite())
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: INVITE_ID },
          auth: { sub: 'u1', tenant: 'o1', email: 'someone-else@example.com' },
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Invitation is for a different email',
    })
  })
  it('audits exactly one project.member.invite_declined after the status write', async () => {
    invites.push(freshInvite())
    await handler(
      fakeEvent({
        params: { invitationId: INVITE_ID },
        auth: { sub: 'u1', tenant: 'o1', email: 'invitee@example.com' },
      }),
    )

    expect(statusUpdates).toEqual([{ status: 'declined' }])
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].payload).toMatchObject({
      organizationId: 'org-acme',
      action: 'project.member.invite_declined',
      targetId: 'p1',
      targetLabel: 'Acme Brand',
      after: { role: 'editor', invitationId: INVITE_ID },
    })
  })

  it('audits nothing when the decline is rejected (403 / 409)', async () => {
    invites.push(freshInvite())
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: INVITE_ID },
          auth: { sub: 'u1', tenant: 'o1', email: 'someone@else.com' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })

    invites.length = 0
    invites.push(freshInvite({ status: 'accepted' }))
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: INVITE_ID },
          auth: { sub: 'u1', tenant: 'o1', email: 'invitee@example.com' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(auditEvents).toHaveLength(0)
  })
})
