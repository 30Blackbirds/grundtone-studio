import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Minimal inline event; h3-mocken kommer fra den delte helper. Identity now
// rides on event.context.auth (set by server/middleware/auth.ts), and the PDP
// grant is mocked so the test stays standalone.
interface FakeEvent {
  params: Record<string, string>
  body: unknown
  headers: Record<string, string>
  context: { auth?: { sub: string; tenant: string; email: string } }
}
function fakeEvent(
  opts: Partial<Omit<FakeEvent, 'context'>> & {
    auth?: { sub: string; tenant: string; email: string }
  } = {},
): FakeEvent {
  return {
    params: { ...(opts.params ?? {}) },
    body: opts.body ?? null,
    headers: { ...(opts.headers ?? {}) },
    context: opts.auth ? { auth: opts.auth } : {},
  }
}
// h3-mocken kommer fra tests/helpers/endpoint-fixtures. Her stod tidligere en
// LOKAL `function mockH3()` med præcis det navn — den lignede den delte kode
// og var en privat kopi, hvis createError tabte statusMessage. Den lokale
// fakeEvent ovenfor bevares: dens felter (params/body/headers) er dem den
// delte mock læser.

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

const memberInserts: Array<{ projectId: string; userId: string; role: string }> = []
const inviteStatusUpdates: Array<{ inviteId: string; status: string }> = []
const grants: Array<{ projectId: string; subject: string; role: string }> = []

vi.mock('h3', () => mockH3())
// eq(col, value) → object stashing the value so the db mock's where() can read
// it back and filter against fixtures.
vi.mock('drizzle-orm', () => ({ eq: (_col: unknown, value: string) => ({ value }) }))

let lastQueriedInviteId: string | null = null

const dbMock = {
  select: () => ({
    from: () => ({
      where: (predicate: { value?: string } | null) => {
        const queriedId = predicate?.value ?? null
        lastQueriedInviteId = queriedId
        return Promise.resolve(invites.filter((inv) => inv.id === queriedId))
      },
    }),
  }),
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
vi.mock('~~/server/lib/pdp', () => ({
  grantProjectRole: vi.fn(async (_e: unknown, projectId: string, subject: string, role: string) => {
    grants.push({ projectId, subject, role })
  }),
}))
vi.mock('~~/server/lib/project-access', () => ({
  PROJECT_ROLES: ['viewer', 'editor', 'admin'],
}))

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
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  }
}

function authedAs(email: string, sub = 'u1') {
  return { auth: { sub, tenant: 'o1', email } }
}

beforeEach(() => {
  invites.length = 0
  memberInserts.length = 0
  inviteStatusUpdates.length = 0
  grants.length = 0
  lastQueriedInviteId = null
})

describe('POST /api/invitations/project/[invitationId]/accept', () => {
  it('400 when invitationId is missing', async () => {
    await expect(handler(fakeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('401 when no actor on the request', async () => {
    await expect(
      handler(fakeEvent({ params: { invitationId: VALID_INVITE_ID } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('404 when the invitation does not exist', async () => {
    invites.length = 0
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: VALID_INVITE_ID },
          ...authedAs('invitee@example.com'),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(lastQueriedInviteId).toBe(VALID_INVITE_ID)
  })

  it('409 when the invitation has already been accepted', async () => {
    invites.push(freshInvite({ status: 'accepted' }))
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: VALID_INVITE_ID },
          ...authedAs('invitee@example.com'),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Invitation is accepted' })
  })

  it('410 when the invitation has expired', async () => {
    invites.push(freshInvite({ expiresAt: new Date(Date.now() - 1000) }))
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: VALID_INVITE_ID },
          ...authedAs('invitee@example.com'),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 410 })
  })

  it("403 when the actor's email doesn't match the invite", async () => {
    invites.push(freshInvite())
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: VALID_INVITE_ID },
          ...authedAs('attacker@evil.dk', 'attacker'),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(memberInserts).toHaveLength(0)
    expect(inviteStatusUpdates).toHaveLength(0)
    expect(grants).toHaveLength(0)
  })

  it('403 check is case-insensitive', async () => {
    invites.push(freshInvite({ email: 'invitee@example.com' }))
    const res = await handler(
      fakeEvent({ params: { invitationId: VALID_INVITE_ID }, ...authedAs('Invitee@Example.com') }),
    )
    expect(res).toMatchObject({ projectId: PROJECT_ID, role: 'editor' })
  })

  it('happy path: grants in PDP, inserts member, flips invite to accepted', async () => {
    invites.push(freshInvite({ role: 'admin' }))

    const res = await handler(
      fakeEvent({ params: { invitationId: VALID_INVITE_ID }, ...authedAs('invitee@example.com') }),
    )

    expect(res).toEqual({ projectId: PROJECT_ID, role: 'admin' })
    expect(grants).toEqual([{ projectId: PROJECT_ID, subject: 'u1', role: 'admin' }])
    expect(memberInserts).toHaveLength(1)
    expect(memberInserts[0]).toMatchObject({ projectId: PROJECT_ID, userId: 'u1', role: 'admin' })
    expect(inviteStatusUpdates).toHaveLength(1)
    expect(inviteStatusUpdates[0].status).toBe('accepted')
  })

  // 🔴 LÅSER at fejlbeskeden kan asserteres — begrundelsen står udførligt i
  // server/api/account/deleted.post.test.ts.
  //
  // Denne fil bar sin egen lokale `function mockH3()`, der SKYGGEDE for den
  // delte helper af samme navn: den lignede fælles kode og var en privat
  // kopi, som satte statusCode men aldrig statusMessage. Den lokale er nu
  // fjernet, og mocken importeres.
  //
  // Sporet efter hullet står lige ovenfor: 409-testen asserterer på
  // `message` frem for `statusMessage`, fordi `statusMessage` ikke var til at
  // læse. Begge bindes nu, så de to felter ikke kan drive fra hinanden.
  it('bærer 409-beskeden på BÅDE statusMessage og message', async () => {
    invites.push(freshInvite({ status: 'accepted' }))
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: VALID_INVITE_ID },
          ...authedAs('invitee@example.com'),
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Invitation is accepted',
      message: 'Invitation is accepted',
    })
  })

  // 403 og 401 svarer forskellige koder, så beskeden er ikke den eneste
  // forskel her — værdien er, at afvisningsgrunden overhovedet ER bundet.
  it('bærer 403-beskeden frem, så afvisningsgrunden er pinnet', async () => {
    invites.push(freshInvite())
    await expect(
      handler(
        fakeEvent({
          params: { invitationId: VALID_INVITE_ID },
          ...authedAs('attacker@evil.dk', 'attacker'),
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Invitation is for a different email',
    })
  })
})
