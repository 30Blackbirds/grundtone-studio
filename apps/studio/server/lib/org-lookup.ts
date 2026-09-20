import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'
import { DEV_BYPASS_ORG, DEV_BYPASS_USER, devAuthBypassEnabled } from './dev-auth-bypass'

// Organization data now lives in the central auth service (Better Auth's
// organization plugin). Studio resolves orgs over HTTP against the auth org API
// instead of querying a local table. We forward the request's cookie so the
// auth service scopes the lookup to the signed-in user's memberships.
//
// Null on missing org; throws on real transport errors so callers can 500.

export interface FullOrg {
  id: string
  name: string
  slug: string
  members?: Array<{ id: string; userId: string; role: string }>
}

function authBase(): string {
  // Server-side kald til auth → brug container-intern adresse (auth:3000) når
  // sat; iss-claim-URL'en (AUTH_ISSUER = browser-vendt localhost:3002) er ikke
  // nåbar inde fra studios container.
  const base = process.env.AUTH_INTERNAL_URL ?? process.env.AUTH_ISSUER
  if (!base) throw new Error('AUTH_INTERNAL_URL or AUTH_ISSUER must be set')
  return base
}

// 🔴 THE LOCAL DESIGN-REVIEW BYPASS HAS TO REACH IN HERE TOO, and finding that
// out took a measurement rather than a guess: these lookups do NOT go through
// studio's own /api/auth proxy, where the stub lives. They call the auth
// service directly with `authBase()`, and they return null without a cookie —
// so pointing AUTH_INTERNAL_URL at studio would not have worked either. A
// bypass that stopped at the proxy would leave /api/projects resolving no org,
// i.e. an empty dashboard behind a door that opened. Same three gates, same
// module; nothing new is trusted here.
function bypassOrg(event: H3Event): FullOrg | null {
  if (!devAuthBypassEnabled(event)) return null
  return {
    id: DEV_BYPASS_ORG.id,
    name: DEV_BYPASS_ORG.name,
    slug: DEV_BYPASS_ORG.slug,
    members: [{ id: 'dev-bypass-member-1', userId: DEV_BYPASS_USER.id, role: 'owner' }],
  }
}

async function fetchFullOrg(
  event: H3Event,
  query: Record<string, string>,
): Promise<FullOrg | null> {
  const stub = bypassOrg(event)
  if (stub) {
    // Answer only for the org the bypass actually has; anything else is a
    // genuine miss, not a stub gap that should masquerade as one.
    const asked = query.organizationSlug ?? query.organizationId
    return asked === stub.slug || asked === stub.id ? stub : null
  }

  const cookie = getRequestHeader(event, 'cookie')
  if (!cookie) return null
  try {
    const org = await $fetch<FullOrg | null>(
      `${authBase()}/api/auth/organization/get-full-organization`,
      {
        query,
        headers: { cookie },
      },
    )
    return org ?? null
  } catch (err) {
    // Better Auth returns 4xx (often surfaced as a thrown FetchError) when the
    // slug/id resolves to no org the user can see. Treat not-found as null;
    // re-throw anything else.
    const status =
      (err as { status?: number; statusCode?: number } | null)?.status ??
      (err as { statusCode?: number } | null)?.statusCode
    if (status === 404 || status === 403 || status === 400) return null
    const msg = (err as { message?: string } | null)?.message ?? ''
    if (/not found/i.test(msg)) return null
    throw err
  }
}

export async function lookupOrgBySlug(
  event: H3Event,
  organizationSlug: string,
): Promise<FullOrg | null> {
  return fetchFullOrg(event, { organizationSlug })
}

export async function lookupOrgById(
  event: H3Event,
  organizationId: string,
): Promise<FullOrg | null> {
  return fetchFullOrg(event, { organizationId })
}

export interface OrgListItem {
  id: string
  name: string
  slug: string
}

/** All orgs the signed-in user is a member of (empty when unauthenticated). */
export async function listCallerOrgs(event: H3Event): Promise<OrgListItem[]> {
  const stub = bypassOrg(event)
  if (stub) return [{ id: stub.id, name: stub.name, slug: stub.slug }]

  const cookie = getRequestHeader(event, 'cookie')
  if (!cookie) return []
  try {
    const orgs = await $fetch<OrgListItem[] | null>(`${authBase()}/api/auth/organization/list`, {
      headers: { cookie },
    })
    return orgs ?? []
  } catch (err) {
    const status =
      (err as { status?: number; statusCode?: number } | null)?.status ??
      (err as { statusCode?: number } | null)?.statusCode
    if (status === 401 || status === 403) return []
    throw err
  }
}
