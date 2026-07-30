import { organization, useSession } from '~~/lib/auth-client'
import {
  type OrgRole,
  canCreateProjects as roleCanCreateProjects,
  canManageBilling as roleCanManageBilling,
  canManageOrgMembers as roleCanManageOrgMembers,
  canViewProjects as roleCanViewProjects,
  findMemberForUser,
  isOrgOwner,
  parseOrgRole,
} from '~~/lib/org-role'

interface OrgListItem {
  id: string
  name: string
  slug: string
}

interface ProjectListItem {
  id: string
  slug: string
  name: string
}

// Stable default factories. Defining these at module scope (instead of
// inline `() => []` per useAsyncData call) means every consumer of
// useOrgContext lands on the same identity-stable empty array while the
// async fetch is pending — no extra reactive churn in downstream watchers
// that compare by reference, and no hydration mismatches from differing
// SSR / CSR allocations.
//
// Object.freeze prevents the shared instance from being mutated in place
// (push/sort/etc.). Without the freeze, an unsuspecting consumer could
// corrupt every other consumer's view and on SSR potentially leak across
// concurrent requests. The cast restores the mutable element type to
// satisfy useAsyncData's default-factory signature — treat as read-only.
const EMPTY_ORG_LIST = Object.freeze<OrgListItem[]>([]) as OrgListItem[]
const EMPTY_PROJECT_LIST = Object.freeze<ProjectListItem[]>([]) as ProjectListItem[]
const noOrgList = () => EMPTY_ORG_LIST
const noProjectList = () => EMPTY_PROJECT_LIST
const noMember = () => null

/**
 * Single source of truth for the user's organizations and the current org/project
 * context derived from the route. Used by layout chrome (org-switcher + sidebar).
 */
export const useOrgContext = () => {
  const route = useRoute()
  const session = useSession()
  const userId = computed(() => session.value.data?.user?.id)

  const activeSlug = computed(() => {
    const m = route.path.match(/^\/orgs\/([^/]+)/)
    return m?.[1] ?? null
  })

  const activeProjectSlug = computed(() => {
    const m = route.path.match(/^\/orgs\/[^/]+\/projects\/([^/]+)/)
    return m?.[1] ?? null
  })

  const { data: orgs, refresh: refreshOrgs } = useAsyncData<OrgListItem[]>(
    'org-context-orgs',
    async () => {
      const res = await organization.list({
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return (res.data ?? []) as OrgListItem[]
    },
    // Client-only: this goes through the auth client to the EXTERNAL auth
    // service, and a failed/empty SSR result sticks — the fixed key hydrates
    // and never refetches, leaving every consumer (sidebar, org-switcher,
    // breadcrumbs) permanently org-less until a hard reload. Same fragility
    // class that made /orgs/** client-rendered (see nuxt.config routeRules);
    // chrome pops in a tick later instead, which the defaults cover.
    { default: noOrgList, server: false },
  )

  const activeOrg = computed(() =>
    activeSlug.value ? (orgs.value?.find((o) => o.slug === activeSlug.value) ?? null) : null,
  )

  const { data: projects, refresh: refreshProjects } = useAsyncData<ProjectListItem[]>(
    () => `org-context-projects-${activeSlug.value ?? 'none'}`,
    async () => {
      if (!activeSlug.value) return []
      // Bypass Nuxt's auto-typed $fetch — its route-shape inference recurses
      // on our server route table and trips TS2321 (excessive stack depth).
      const fetcher = $fetch as (url: string, opts?: unknown) => Promise<ProjectListItem[]>
      return await fetcher('/api/projects', {
        headers: useRequestHeaders(['cookie']),
        query: { organizationSlug: activeSlug.value },
      })
    },
    { default: noProjectList, watch: [activeSlug] },
  )

  const { data: activeMember, refresh: refreshActiveMember } = useAsyncData(
    () => `org-context-member-${activeOrg.value?.id ?? 'none'}-${userId.value ?? 'anon'}`,
    async () => {
      if (!activeOrg.value?.id || !userId.value) return null
      const res = await organization.getFullOrganization({
        query: { organizationId: activeOrg.value.id },
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return findMemberForUser(res.data?.members, userId.value)
    },
    { default: noMember, watch: [activeOrg, userId] },
  )

  // Sentry-style 5-tier org roles (see server/lib/project-access.ts for the
  // canonical mapping). UI gates derive from these flags rather than reading
  // role strings directly, so a role rename doesn't ripple through templates.
  //
  // Better Auth's client types narrow Member.role to 'owner' | 'admin' | 'member',
  // so we widen via string at the read boundary — the actual values are
  // validated by the server-side ac config in server/lib/auth.ts.
  const role = computed<OrgRole | null>(() =>
    parseOrgRole(activeMember.value?.role as string | undefined),
  )
  const isOwner = computed(() => isOrgOwner(role.value))
  const isManager = computed(() => role.value === 'manager')
  const isAdmin = computed(() => role.value === 'admin')
  const canManageOrgMembers = computed(() => roleCanManageOrgMembers(role.value))
  const canManageBilling = computed(() => roleCanManageBilling(role.value))
  const canCreateProjects = computed(() => roleCanCreateProjects(role.value))
  const canViewProjects = computed(() => roleCanViewProjects(role.value))

  return {
    orgs,
    activeOrg,
    activeSlug,
    activeProjectSlug,
    projects,
    activeMember,
    role,
    isOwner,
    isManager,
    isAdmin,
    canManageOrgMembers,
    canManageBilling,
    canCreateProjects,
    canViewProjects,
    refreshOrgs,
    refreshProjects,
    refreshActiveMember,
  }
}
