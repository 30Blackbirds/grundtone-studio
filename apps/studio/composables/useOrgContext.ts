import { organization } from '~~/lib/auth-client'

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

/**
 * Single source of truth for the user's organizations and the current org/project
 * context derived from the route. Used by layout chrome (org-switcher + sidebar).
 */
export const useOrgContext = () => {
  const route = useRoute()

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
    { default: () => [] },
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
    { default: () => [], watch: [activeSlug] },
  )

  const { data: activeMember, refresh: refreshActiveMember } = useAsyncData(
    () => `org-context-member-${activeOrg.value?.id ?? 'none'}`,
    async () => {
      if (!activeOrg.value?.id) return null
      const res = await organization.getActiveMember({
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return res.data ?? null
    },
    { default: () => null, watch: [activeOrg] },
  )

  const isOwner = computed(() => activeMember.value?.role === 'owner')
  const isAdmin = computed(() => activeMember.value?.role === 'admin' || isOwner.value)

  return {
    orgs,
    activeOrg,
    activeSlug,
    activeProjectSlug,
    projects,
    activeMember,
    isOwner,
    isAdmin,
    refreshOrgs,
    refreshProjects,
    refreshActiveMember,
  }
}
