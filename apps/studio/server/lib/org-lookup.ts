import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'
import { authMode } from './oidc/config'
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
  /** Better Auth returns the organization row's createdAt (ISO string). */
  createdAt?: string
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

  if (authMode() === 'oidc') return localFullOrg(event, query)

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
    if (org) announceTenant(org)
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

// Every successful lookup is cookie-scoped by auth to the caller's own
// memberships, so reaching this line proves a signed-in member is using the org
// in Studio. That is the moment Studio announces the org to account
// (server/lib/tenant-outbox.ts explains why first use, not creation). Not
// awaited: the request does not wait on the outbox, and the hook never throws.
// Imported lazily so this module, which most handlers load, does not pull the
// database client in at import time.
function announceTenant(org: FullOrg): void {
  import('./tenant-outbox')
    .then(({ ensureTenantProvisioned }) => ensureTenantProvisioned(org))
    .catch((err: unknown) => console.error('[tenant-outbox] hook failed to load:', err))
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

  if (authMode() === 'oidc') return localOrgList(event)

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

// ─── oidc mode: Studio's own tables ───────────────────────────────────────
// Same shapes as the auth service answers with. The member id is the user id
// (Studio has no separate member row), and, as with the auth service's
// cookie-scoped lookup, an org the caller is not a member of is simply null.
// No tenant announcement: there is no account service behind a standalone
// Studio.

async function localFullOrg(
  event: H3Event,
  query: Record<string, string>,
): Promise<FullOrg | null> {
  const actor = event.context.auth
  if (!actor || actor.sub.startsWith('machine:')) return null
  const [{ db }, orgs] = await Promise.all([import('../db'), import('./local-orgs')])
  const { organizationSlug, organizationId } = query
  const by = organizationSlug
    ? { slug: organizationSlug }
    : organizationId
      ? { id: organizationId }
      : null
  if (!by) return null
  // A malformed id names nothing; it must not reach the database as a question.
  if (organizationId && !organizationSlug && !/^[0-9a-f-]{36}$/i.test(organizationId)) return null
  const org = await orgs.getOrganization(db, actor.sub, by)
  if (!org) return null
  const members = await orgs.listMembers(db, { id: actor.sub, email: actor.email ?? null }, org.id)
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt.toISOString(),
    members: members.map((m) => ({ id: m.userId, userId: m.userId, role: m.role })),
  }
}

async function localOrgList(event: H3Event): Promise<OrgListItem[]> {
  const actor = event.context.auth
  if (!actor || actor.sub.startsWith('machine:')) return []
  const [{ db }, orgs] = await Promise.all([import('../db'), import('./local-orgs')])
  return (await orgs.listOrganizations(db, actor.sub)).map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
  }))
}
