import type { H3Event } from 'h3'
import { auth } from './auth'

// Better Auth's auth.api.getFullOrganization throws an APIError when the slug
// resolves to no org (instead of returning null). Wrap it once so our route
// handlers can stay flat and consistent — null on missing, throw on real
// errors (DB outage etc).

interface FullOrg {
  id: string
  name: string
  slug: string
  members?: Array<{ id: string; userId: string; role: string }>
}

export async function lookupOrgBySlug(
  event: H3Event,
  organizationSlug: string,
): Promise<FullOrg | null> {
  try {
    const org = (await auth.api.getFullOrganization({
      headers: event.headers,
      query: { organizationSlug },
    })) as FullOrg | null
    return org ?? null
  } catch (err) {
    const msg = (err as { message?: string } | null)?.message ?? ''
    if (/not found/i.test(msg)) return null
    throw err
  }
}
