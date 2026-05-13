// Project-scoped effective role for the current session. Resolves the same
// max(org-role, project-role) that the server uses, so UI gates can hide
// affordances the user wouldn't be able to use anyway.

import { useSession } from '~~/lib/auth-client'

export type ProjectRole = 'viewer' | 'editor' | 'admin'

interface MembersResponse {
  orgMembers: Array<{ userId: string; role: string }>
  direct: Array<{ userId: string; role: string }>
}

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, admin: 2 }

// Mirrors server/lib/project-access.ts. Sentry-style:
//   owner | manager  → admin  (full power on every project)
//   admin  | member  → viewer (read-only across the org by default)
//   billing          → null   (no project access)
function orgRoleToProjectRole(role: string | undefined | null): ProjectRole | null {
  if (role === 'owner' || role === 'manager') return 'admin'
  if (role === 'admin' || role === 'member') return 'viewer'
  return null
}

function asProjectRole(role: string | undefined | null): ProjectRole | null {
  return role === 'viewer' || role === 'editor' || role === 'admin' ? role : null
}

function maxRole(a: ProjectRole | null, b: ProjectRole | null): ProjectRole | null {
  if (!a) return b
  if (!b) return a
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b
}

export const useProjectRole = (projectId: Ref<string | null | undefined>) => {
  const session = useSession()

  const { data: members } = useAsyncData<MembersResponse | null>(
    () => `project-role-${projectId.value ?? 'none'}`,
    async () => {
      if (!projectId.value) return null
      return await ($fetch as (url: string, opts?: unknown) => Promise<MembersResponse>)(
        `/api/projects/${projectId.value}/members`,
        { headers: useRequestHeaders(['cookie']) },
      )
    },
    { default: () => null, watch: [projectId] },
  )

  const role = computed<ProjectRole | null>(() => {
    const userId = session.value.data?.user?.id
    if (!userId || !members.value) return null
    const orgRole = members.value.orgMembers.find((m) => m.userId === userId)?.role
    const directRole = members.value.direct.find((m) => m.userId === userId)?.role
    return maxRole(orgRoleToProjectRole(orgRole), asProjectRole(directRole))
  })

  const can = (min: ProjectRole) =>
    computed(() => Boolean(role.value && ROLE_RANK[role.value] >= ROLE_RANK[min]))

  return {
    role,
    members,
    canView: can('viewer'),
    canEdit: can('editor'),
    canManage: can('admin'),
  }
}
