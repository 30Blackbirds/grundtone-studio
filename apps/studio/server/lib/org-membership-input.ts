import { createError, getRequestHeader, type H3Event } from 'h3'
import type { z } from 'zod'
import type { OrgRole } from './project-access'

// The role rules the members page applies (composables/useOrgRoles.ts), applied
// again on the server. The page hides what an actor may not do; until now
// nothing on studio's side refused it, and whether auth refuses it is not
// measured. org-membership-input.test.ts holds the two copies equal.

/** Roles that can be given by invitation or role change; owner is a transfer. */
export const ASSIGNABLE = ['billing', 'member', 'admin', 'manager'] as const

// Rank order, lowest first, as project-access.ts's ORG_ROLES. A local copy
// because project-access.ts loads the database, and these rules must not.
export const ORG_RANK: readonly OrgRole[] = ['billing', 'member', 'admin', 'manager', 'owner']

const rank = (role: OrgRole) => ORG_RANK.indexOf(role)

/** An actor may give only a role below its own; an owner may give any. */
export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  return actor === 'owner' || rank(actor) > rank(target)
}

/** An actor may change or remove only a member below its own rank; an owner, anyone. */
export function canManageMember(actor: OrgRole, targetCurrent: OrgRole): boolean {
  return actor === 'owner' || rank(actor) > rank(targetCurrent)
}

/** A body that does not match is the caller's error (400), not the server's. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Invalid body',
    })
  }
  return parsed.data
}

/**
 * 🔴 CSRF, NOW STUDIO'S JOB. These routes act with the caller's session cookie,
 * and once studio's server is the one calling auth, auth's own Origin check
 * sees studio's request, not the browser's page. Without a check here a page on
 * another site could make a signed-in user's browser change org membership
 * through studio (a confused deputy).
 *
 * Same origin only: the request's Origin must be, as a whole origin (scheme,
 * host and port), the origin the request was sent to or the configured public
 * app URL. The scheme the browser used comes from `X-Forwarded-Proto` behind a
 * proxy, else from the socket. A missing Origin is refused too; browsers send
 * it on every POST, PATCH and DELETE, and nothing server-side calls these
 * routes. `Sec-Fetch-Site`, when present (a page cannot set it), must say
 * `same-origin`.
 */
export function assertSameOrigin(event: H3Event, appUrl = process.env.NUXT_PUBLIC_APP_URL): void {
  const site = getRequestHeader(event, 'sec-fetch-site')
  const allowed = new Set(
    [requestOrigin(event), originOf(appUrl)].filter((o): o is string => Boolean(o)),
  )
  const from = originOf(getRequestHeader(event, 'origin'))
  if (!from || !allowed.has(from) || (site && site !== 'same-origin')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cross-origin request refused',
      data: { code: 'cross_origin' },
    })
  }
}

function requestOrigin(event: H3Event): string | null {
  const host = getRequestHeader(event, 'host')
  if (!host) return null
  const forwarded = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  const encrypted = (event as { node?: { req?: { socket?: { encrypted?: boolean } } } }).node?.req
    ?.socket?.encrypted
  return originOf(`${forwarded || (encrypted ? 'https' : 'http')}://${host}`)
}

/** `new URL(x).origin`, or null for anything that is not an http(s) origin. */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * The header auth will require on its org-membership writes (ClickUp
 * 1amk32fna12), so that only studio's server can make them. Its value is a
 * server-only secret; the generic /api/auth proxy never attaches it and strips
 * any copy a browser sends.
 */
export const ORG_WRITE_CREDENTIAL_HEADER = 'x-klanghaus-org-write-credential'

/** Auth's org-membership writes, which studio makes only through its own routes. */
export const ORG_WRITE_AUTH_PATHS: readonly string[] = [
  'organization/create',
  'organization/delete',
  'organization/invite-member',
  'organization/accept-invitation',
  'organization/update-member-role',
  'organization/remove-member',
  'organization/leave',
]

/**
 * True when a request path under /api/auth names one of those writes, in the
 * spellings that reach the same endpoint: percent-encoding, doubled or
 * trailing slashes, upper case, and dot segments (`x/../leave`, `./leave`,
 * `%2e%2e`), resolved the way the proxy's own fetch resolves them. A path that
 * cannot be decoded is treated as a write.
 */
export function isOrgWriteAuthPath(path: string): boolean {
  let p = path.split('?')[0]!
  try {
    p = decodeURIComponent(p)
  } catch {
    return true
  }
  p = p.toLowerCase().replace(/\/+/g, '/')
  // Resolve `.` and `..` segments: the proxy's fetch does, so auth would see
  // the resolved path.
  p = new URL(p, 'http://x').pathname
  p = p.replace(/^\/api\/auth\//, '').replace(/\/+$/, '')
  return ORG_WRITE_AUTH_PATHS.includes(p)
}
