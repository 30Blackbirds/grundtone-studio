import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal inline event + h3 mock. The full helper in
// tests/helpers/endpoint-fixtures.ts is the long-term home; this file
// inlines the surface we actually need so the test stays loadable even
// before that helper exists on the branch.
interface FakeEvent {
  params: Record<string, string>
  body: unknown
  headers: Record<string, string>
}
function fakeEvent(opts: Partial<FakeEvent> = {}): FakeEvent {
  return {
    params: { ...(opts.params ?? {}) },
    body: opts.body ?? null,
    headers: { ...(opts.headers ?? {}) },
  }
}
function mockH3() {
  return {
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: (event: FakeEvent, name: string) => event.params[name],
    readBody: (event: FakeEvent) => Promise.resolve(event.body),
    getRequestHeader: (event: FakeEvent, name: string) => event.headers[name.toLowerCase()] ?? null,
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
  role: 'viewer' | 'editor' | 'admin'
  status: 'pending' | 'accepted' | 'cancelled'
  invitedBy: string
  expiresAt: Date
}

const invites: InviteRow[] = []
let signedInEmail: string | null = null

const memberInserts: Array<{ projectId: string; userId: string; role: string }> = []
const inviteStatusUpdates: Array<{ inviteId: string; status: string }> = []

vi.mock('h3', () => mockH3())
// eq(col, value) → object stashing the value so the db mock's
// where() can read it back and filter against fixtures.
vi.mock('drizzle-orm', () => ({ eq: (_col: unknown, value: string) => ({ value }) }))

// Capture the id passed to the most recent invite where(eq(...)) so the
// mock filters like the real query — guards against a regression where
// the handler queries by the wrong column or skips the predicate.
let lastQueriedInviteId: string | null = null

const dbMock = {
  select: (cols?: Record<string, unknown>) => {
    const isUserQuery = cols && 'email' in cols
    return {
      from: () => ({
        where: (predicate: { value?: string } | null) => {
          if (isUserQuery) {
            return Promise.resolve(signedInEmail ? [{ email: signedInEmail }] : [])
          }
          // The handler calls `where(eq(projectInvitation.id, invitationId))`.
          // Our eq() mock below stashes the value on the returned object so
          // we can filter accurately here.
          const queriedId = predicate?.value ?? null
          lastQueriedInviteId = queriedId
          return Promise.resolve(invites.filter((inv) => inv.id === queriedId))
        },
      }),
    }
  },
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      insert: () => ({
        values: (v: { projectId: string; userId: string; role: string }) => {
          memberInserts.push({ projectId: v.projectId, userId: v.userId, role: v.role })
          return { onConflictDoUpdate: () => Promise.resolve() }
        },
      }),
      update: () => ({
        set: (s: { status: string }) => ({
          where: () => {
            inviteStatusUpdates.push({ inviteId: invites[0]?.id ?? '', status: s.status })
            return Promise.resolve()
          },
        }),
      }),
    }
    return fn(tx)
  },
}
vi.mock('~~/server/db', () => ({ db: dbMock }))
vi.mock('~~/server/db/schema', () => ({
  projectInvitation: { _: { name: 'project_invitation' }, id: 'id' },
  projectMember: { _: { name: 'project_member' }, projectId: 'projectId', userId: 'userId' },
}))
vi.mock('~~/server/db/schema/auth', () => ({
  user: { _: { name: 'user' }, email: 'email', id: 'id' },
}))

const getSession = vi.fn()
vi.mock('~~/server/lib/auth', () => ({ auth: { api: { getSession } } }))

const handler = (await import('./accept.post')).default as unknown as (
  event: unknown,
) => Promise<unknown>

const VALID_INVITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function freshInvite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: VALID_INVITE_ID,
    projectId: PROJECT_ID,
    email: 'invitee@example.com',
    role: 'editor',
    status: 'pending',
    invitedBy: 'inviter-user-id',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days out
    ...overrides,
  }
}

beforeEach(() => {
  invites.length = 0
  memberInserts.length = 0
  inviteStatusUpdates.length = 0
  signedInEmail = null
  lastQueriedInviteId = null
  getSession.mockReset()
})

describe('POST /api/invitations/project/[invitationId]/accept', () => {
  it('400 when invitationId is missing', async () => {
    await expect(handler(fakeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('401 when no session', async () => {
    getSession.mockResolvedValue(null)
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('404 when the invitation does not exist', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'invitee@example.com' } })
    invites.length = 0
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 404 })
    // Sanity-check that the handler did query by the invitationId we passed.
    expect(lastQueriedInviteId).toBe(VALID_INVITE_ID)
  })

  it('404 when an invite exists but for a different id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'invitee@example.com' } })
    // An invite exists under a different id — the where(eq(id, …)) filter
    // must reject the lookup, not blindly return the first row.
    invites.push(freshInvite({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }))
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('409 when the invitation has already been accepted', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'invitee@example.com' } })
    invites.push(freshInvite({ status: 'accepted' }))
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Invitation is accepted' })
  })

  it('409 when the invitation has been cancelled', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'invitee@example.com' } })
    invites.push(freshInvite({ status: 'cancelled' }))
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Invitation is cancelled' })
  })

  it('410 when the invitation has expired', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'invitee@example.com' } })
    invites.push(freshInvite({ expiresAt: new Date(Date.now() - 1000) }))
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 410 })
  })

  it("403 when the signed-in user's email doesn't match the invite", async () => {
    // Mismatched email: an attacker with a stolen invite-link can't accept
    // it using their own logged-in account.
    getSession.mockResolvedValue({ user: { id: 'attacker', email: 'attacker@evil.dk' } })
    signedInEmail = 'attacker@evil.dk'
    invites.push(freshInvite())
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(memberInserts).toHaveLength(0)
    expect(inviteStatusUpdates).toHaveLength(0)
  })

  it('403 is case-insensitive — same email regardless of casing differences ', async () => {
    // The invite was sent to lower-case; the user signs up with MixedCase
    // (Better Auth normalises but the assertion belongs on our side too).
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'Invitee@Example.com' } })
    signedInEmail = 'Invitee@Example.com'
    invites.push(freshInvite({ email: 'invitee@example.com' }))

    const res = await handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } }))
    expect(res).toMatchObject({ projectId: PROJECT_ID, role: 'editor' })
  })

  it('happy path: inserts project_member and flips invite to accepted', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'invitee@example.com' } })
    signedInEmail = 'invitee@example.com'
    invites.push(freshInvite({ role: 'admin' }))

    const res = await handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } }))

    expect(res).toEqual({ projectId: PROJECT_ID, role: 'admin' })
    expect(memberInserts).toHaveLength(1)
    expect(memberInserts[0]).toMatchObject({
      projectId: PROJECT_ID,
      userId: 'u1',
      role: 'admin',
    })
    expect(inviteStatusUpdates).toHaveLength(1)
    expect(inviteStatusUpdates[0].status).toBe('accepted')
  })
})
