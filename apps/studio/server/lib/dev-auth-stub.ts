import { DEV_BYPASS_ORG, DEV_BYPASS_USER } from './dev-auth-bypass'

// The answers the local bypass gives in place of the central auth service.
//
// 🔴 WHY A STUB AND NOT JUST A SERVER-SIDE FLAG. Measured before writing any of
// it: the pages behind login do NOT read their identity from studio's server.
// `useOrgContext` and the members page call the central auth service from the
// BROWSER (`organization.list`, `getFullOrganization`, `listMembers`,
// `listInvitations`, `useSession`). A bypass that only set
// `event.context.auth` would let a visitor through the door and then show them
// empty chrome — no org, no switcher, no members — which is worse than the
// locked door for judging a design.
//
// In production those calls do not go to the auth service directly either:
// studio proxies them through its OWN origin (`server/api/auth/[...].ts`, the
// BFF, so the session cookie stays first-party). That proxy is therefore the
// one seam both halves already pass through, and gating it covers client and
// server at once instead of in two places that can drift apart.

type MemberRole = 'owner' | 'admin' | 'member'

// Synthetic co-members so a members list has more than one row to judge. The
// names are obviously fictional; no production data is copied here.
const OTHER_MEMBERS = [
  { id: 'dev-bypass-member-2', name: 'Bo Lindholm', email: 'bo@localhost.invalid', role: 'admin' },
  { id: 'dev-bypass-member-3', name: 'Sine Krag', email: 'sine@localhost.invalid', role: 'member' },
] as const

const createdAt = new Date('2026-01-15T10:00:00Z')

function member(id: string, user: { id: string; name: string; email: string }, role: MemberRole) {
  return {
    id,
    organizationId: DEV_BYPASS_ORG.id,
    userId: user.id,
    role,
    createdAt,
    user: { id: user.id, name: user.name, email: user.email, image: null },
  }
}

const members = [
  member('dev-bypass-member-1', DEV_BYPASS_USER, 'owner'),
  ...OTHER_MEMBERS.map((m) => member(m.id, m, m.role)),
]

const session = {
  session: {
    id: 'dev-bypass-session',
    userId: DEV_BYPASS_USER.id,
    activeOrganizationId: DEV_BYPASS_ORG.id,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    createdAt,
    updatedAt: createdAt,
  },
  user: DEV_BYPASS_USER,
}

const fullOrganization = { ...DEV_BYPASS_ORG, createdAt, members, invitations: [] }

const invitations = [
  {
    id: 'dev-bypass-invitation-1',
    organizationId: DEV_BYPASS_ORG.id,
    email: 'ny.kollega@localhost.invalid',
    role: 'member',
    status: 'pending',
    inviterId: DEV_BYPASS_USER.id,
    // 🔴 A PLAUSIBLE DATE, NOT A FAR-FUTURE ONE. My first version used 2099 and
    // the page rendered "expires in 26401 days" — a number no real invitation
    // can show, sitting in the exact spot a designer is judging. Fixture values
    // that appear in the UI have to be as realistic as the thing they stand in
    // for, or the review is of the fixture. Six days out, computed at request
    // time so it never drifts into the past.
    get expiresAt() {
      return new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)
    },
  },
]

/**
 * The auth paths the pages behind login actually call, measured from the
 * client code rather than assumed from Better Auth's documentation.
 *
 * 🔴 ANYTHING NOT LISTED MUST FAIL LOUDLY, not fall through to a proxy that
 * has no auth service behind it locally. An unknown path returning an empty
 * 200 would surface as a blank panel that looks like a design problem — the
 * reviewer would report the stub's gap as a defect in the page.
 */
export const DEV_AUTH_STUB_ROUTES: Record<string, unknown> = {
  'get-session': session,
  'organization/list': [DEV_BYPASS_ORG],
  'organization/list-members': { members, total: members.length },
  'organization/list-invitations': invitations,
  'organization/get-full-organization': fullOrganization,
  'organization/set-active': fullOrganization,
}

/** `/api/auth/organization/list?x=1` -> `organization/list` */
export function stubKeyFor(path: string): string {
  return path
    .replace(/^\/api\/auth\//, '')
    .split('?')[0]!
    .replace(/\/$/, '')
}
