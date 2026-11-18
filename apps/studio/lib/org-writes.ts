// The browser's org-membership writes, through studio's own routes
// (server/api/orgs/**, server/api/org-invitations/**). Studio's server writes
// auth AND its own record of org roles in one step, so these must never go to
// auth's organization client directly.
//
// Each call answers in the shape the Better Auth client used, `{ data, error }`,
// so the pages that called `organization.*` keep their handling unchanged.

export interface OrgWriteResult<T> {
  data: T | null
  error: { message?: string; code?: string; status?: number } | null
}

type Method = 'POST' | 'PATCH' | 'DELETE'

// Untyped on purpose: Nitro's typed $fetch resolves every route for a URL held
// in a variable and exceeds the compiler's depth. The URLs are built below.
// Read on each call, not at import: $fetch is a global that is not there yet
// when some tests import a page that imports this file.
const send = (url: string, opts: { method: Method; body?: object }) =>
  ($fetch as unknown as (u: string, o: typeof opts) => Promise<unknown>)(url, opts)

async function call<T>(url: string, method: Method, body?: object): Promise<OrgWriteResult<T>> {
  try {
    const data = (await send(url, { method, ...(body ? { body } : {}) })) as T
    return { data, error: null }
  } catch (err) {
    const e = err as {
      statusCode?: number
      statusMessage?: string
      message?: string
      data?: { statusMessage?: string; data?: { code?: string } }
    }
    return {
      data: null,
      error: {
        status: e?.statusCode,
        message: e?.data?.statusMessage ?? e?.statusMessage ?? e?.message,
        code: e?.data?.data?.code,
      },
    }
  }
}

const seg = encodeURIComponent

export const orgWrites = {
  create: (input: { name: string; slug: string }) =>
    call<{ id?: string; name?: string }>('/api/orgs', 'POST', input),

  delete: (orgId: string) => call<unknown>(`/api/orgs/${seg(orgId)}`, 'DELETE'),

  inviteMember: (orgId: string, input: { email: string; role: string; resend?: boolean }) =>
    call<{ id?: string }>(`/api/orgs/${seg(orgId)}/invitations`, 'POST', input),

  acceptInvitation: (invitationId: string) =>
    call<{ invitation?: { organizationId?: string } }>(
      `/api/org-invitations/${seg(invitationId)}/accept`,
      'POST',
    ),

  updateMemberRole: (orgId: string, memberId: string, role: string) =>
    call<unknown>(`/api/orgs/${seg(orgId)}/memberships/${seg(memberId)}`, 'PATCH', { role }),

  removeMember: (orgId: string, memberId: string) =>
    call<unknown>(`/api/orgs/${seg(orgId)}/memberships/${seg(memberId)}`, 'DELETE'),

  transferOwnership: (orgId: string, userId: string) =>
    call<unknown>(`/api/orgs/${seg(orgId)}/ownership-transfer`, 'POST', { userId }),

  leave: (orgId: string) => call<unknown>(`/api/orgs/${seg(orgId)}/leave`, 'POST'),
}
