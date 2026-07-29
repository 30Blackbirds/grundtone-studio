import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same standalone harness as accept.test.ts: inline h3/db mocks, identity on
// event.context.auth. Decline has no PDP grant and no transaction — it only
// flips the invitation status, so the mock surface is smaller.
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
function mockH3() {
  return {
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: (event: FakeEvent, name: string) => event.params[name],
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
      const err = new Error(opts.statusMessage ?? '') as Error & { statusCode: number }
      err.statusCode = opts.statusCode
      return err
    },
  }
}

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
    from: () => ({
      where: (predicate: { value?: string } | null) =>
        Promise.resolve(invites.filter((inv) => inv.id === (predicate?.value ?? null))),
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
  projectInvitation: { _: { name: 'project_invitation' }, id: 'id' },
}))

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
})
