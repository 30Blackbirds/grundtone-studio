import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'

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

async function fetchFullOrg(
  event: H3Event,
  query: Record<string, string>,
): Promise<FullOrg | null> {
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
