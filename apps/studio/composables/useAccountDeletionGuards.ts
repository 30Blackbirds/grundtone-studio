import { organization } from '~~/lib/auth-client'

export interface SoleOwnerBlock {
  orgId: string
  orgName: string
  orgSlug: string
}

export interface AccountDeletionGuardResult {
  blocked: boolean
  soleOwnerOrgs: SoleOwnerBlock[]
}

export function isSoleOwnerOfOrg(
  members: ReadonlyArray<{ userId: string; role: string }>,
  userId: string,
): boolean {
  const owners = members.filter((m) => m.role === 'owner')
  return owners.length === 1 && owners[0]?.userId === userId
}

/**
 * Checks whether the current user can self-delete their account. Blocks when
 * they are the sole owner of any organization — they must transfer ownership
 * or delete the org first.
 */
export async function checkAccountDeletionGuards(
  userId: string | undefined,
): Promise<AccountDeletionGuardResult> {
  if (!userId) return { blocked: false, soleOwnerOrgs: [] }

  const res = await organization.list({
    fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
  })
  const orgs = res.data ?? []
  const soleOwnerOrgs: SoleOwnerBlock[] = []

  for (const org of orgs) {
    const full = await organization.getFullOrganization({
      query: { organizationId: org.id },
      fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
    })
    const members = full.data?.members ?? []
    if (isSoleOwnerOfOrg(members, userId)) {
      soleOwnerOrgs.push({ orgId: org.id, orgName: org.name, orgSlug: org.slug })
    }
  }

  return { blocked: soleOwnerOrgs.length > 0, soleOwnerOrgs }
}
