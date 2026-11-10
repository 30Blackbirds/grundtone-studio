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
    // The R5 table has an "Invited" column. Better Auth's invitation really
    // carries `createdAt` (plugins/organization/schema.d.mts), so the column
    // has a data source in production — the fixture was simply missing it, and
    // an empty column on the review server reads as a defect in the page.
    createdAt: new Date('2026-09-14T09:00:00Z'),
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

/**
 * 🔴 THE 22 PATHS STUDIO CALLS AND THE STUB DOES NOT ANSWER, split by whether
 * they may EVER be stubbed. Measured 2026-09-20 on main 0c2f875 — call sites
 * grepped in studio, paths read from the installed better-auth 1.6.25, answers
 * probed against the running bypass server. 28 called, 6 answered, 22 × 501.
 *
 * The list is not documentation. `dev-auth-stub.test.ts` fails when studio
 * calls a path that appears in neither this file's answers nor these two
 * lists — so the denominator stops growing silently, which is the difference
 * between having counted once and continuing to count.
 *
 * 🔴 THE SPLIT IS [sikkerhed]'S, AND IT IS THE LOAD-BEARING PART:
 * a 501 is a DEAD button; a stub is a button that LOOKS LIKE IT WORKS. For
 * anything that in production changes a RIGHT, an INVITATION or a SESSION, the
 * dead button is the safe one, because a stub that returns success teaches the
 * reviewer that the action worked — and that is the wrong thing to learn about
 * exactly those actions.
 *
 * `sign-out` is the sharp case, and it is also the one a reviewer meets first
 * (the sidebar is on every page behind login): a stubbed sign-out returning 200
 * without ending the session would tell a designer they are signed out on a
 * machine where the bypass is still wide open.
 */
export const NEVER_STUB_AUTH_PATHS: readonly string[] = [
  // Session and credentials.
  'sign-out',
  'sign-in/magic-link',
  'sign-in/email',
  'sign-up/email',
  'change-email',
  'change-password',
  'request-password-reset',
  'reset-password',
  'delete-user',
  'send-verification-email',
  // Rights and invitations.
  'organization/invite-member',
  'organization/cancel-invitation',
  'organization/accept-invitation',
  'organization/reject-invitation',
  'organization/update-member-role',
  'organization/remove-member',
  'organization/leave',
  'organization/delete',
  // Creating an org makes the caller its owner, so it is a right too. Studio
  // no longer calls it through this proxy (server/api/orgs/index.post.ts does).
  'organization/create',
]

/**
 * Paths that MAY be stubbed if [designer] asks for the flow — they change what
 * is displayed, not who may do what. Nothing here is stubbed yet, and nothing
 * will be until the flows are named: guessing which ones a review needs is how
 * the other seventeen stayed hidden behind a fix for one.
 */
export const STUBBABLE_AUTH_PATHS: readonly string[] = [
  'organization/update',
  'organization/get-invitation',
  'update-user',
]

/** Which answer a caller gets for a path the stub does not serve. */
export function unstubbedGroup(key: string): 'never' | 'on-request' {
  return NEVER_STUB_AUTH_PATHS.includes(key) ? 'never' : 'on-request'
}

/** `/api/auth/organization/list?x=1` -> `organization/list` */
export function stubKeyFor(path: string): string {
  return path
    .replace(/^\/api\/auth\//, '')
    .split('?')[0]!
    .replace(/\/$/, '')
}
