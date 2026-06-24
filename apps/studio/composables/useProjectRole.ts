// Project-scoped effective role for the current session. The decision now comes
// from the central Permissions PDP via /api/projects/[id]/access, so UI gates
// match exactly what the server enforces (no more client-side max(orgRole,
// projectRole) re-derivation — the PDP owns that logic).

export type ProjectRole = 'viewer' | 'editor' | 'admin'

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, admin: 2 }

interface AccessResponse {
  role: ProjectRole | null
}

export const useProjectRole = (projectId: Ref<string | null | undefined>) => {
  const { data } = useAsyncData<AccessResponse | null>(
    () => `project-access-${projectId.value ?? 'none'}`,
    async () => {
      if (!projectId.value) return null
      return await ($fetch as (url: string, opts?: unknown) => Promise<AccessResponse>)(
        `/api/projects/${projectId.value}/access`,
        { headers: useRequestHeaders(['cookie']) },
      )
    },
    { default: () => null, watch: [projectId] },
  )

  const role = computed<ProjectRole | null>(() => data.value?.role ?? null)

  const can = (min: ProjectRole) =>
    computed(() => Boolean(role.value && ROLE_RANK[role.value] >= ROLE_RANK[min]))

  return {
    role,
    canView: can('viewer'),
    canEdit: can('editor'),
    canManage: can('admin'),
  }
}
