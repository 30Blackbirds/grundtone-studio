import type { Interceptor } from '@connectrpc/connect'
import type { H3Event } from 'h3'
import { createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { PermissionsService } from '@klanghaus/permissions-client/connect'

// Central Permissions PDP client (Beslutning O/W). Studio asks the PDP for every
// authz decision instead of querying membership tables locally. The PDP derives
// the tenant from the JWT `org` claim — we never send a tenant in the body.
//
// Fail-closed: a missing actor, a transport error, or a thrown RPC all surface
// as "denied". Callers in project-access.ts translate that into 401/403.

// Project relations the PDP understands. The OpenFGA model implements
// can_view/can_edit/can_admin as max(orgRole, projectRole); studio passes the
// action and the PDP maps action→relation.
export type ProjectAction = 'can_view' | 'can_edit' | 'can_admin'

// Organization relations.
export type OrgRelation = 'owner' | 'admin' | 'manager' | 'member' | 'billing'

export function projectResource(projectId: string): string {
  return `project:${projectId}`
}

export function orgResource(orgId: string): string {
  return `organization:${orgId}`
}

// Write-path tuple subjects are type-prefixed OpenFGA users (`user:<sub>`),
// matching the org/project role tuples the model stores. Check subjects stay
// bare per the PDP's action→relation convention.
function userSubject(sub: string): string {
  return `user:${sub}`
}

function getActor(event: H3Event) {
  return event.context.auth ?? null
}

function bearerInterceptor(token: string): Interceptor {
  return (next) => (req) => {
    req.header.set('Authorization', `Bearer ${token}`)
    return next(req)
  }
}

async function getToken(event: H3Event): Promise<string | null> {
  // Re-exchange the forwarded session cookie for a fresh JWT to attach to the
  // PDP call. The auth middleware already verified the session for this request,
  // but the PDP needs the raw bearer token (it re-verifies + reads the org
  // claim), so we fetch it here rather than smuggling it through context.
  // Server-side → container-intern auth-adresse (AUTH_INTERNAL_URL), ikke den
  // browser-vendte AUTH_ISSUER (localhost:3002 er ikke nåbar fra containeren).
  const authUrl = process.env.AUTH_INTERNAL_URL ?? process.env.AUTH_ISSUER
  const cookieHeader = event.node.req.headers.cookie
  if (!authUrl || !cookieHeader) return null
  try {
    const res = await $fetch<{ token?: string }>(`${authUrl}/api/auth/token`, {
      headers: { cookie: cookieHeader },
    })
    return res.token ?? null
  } catch {
    return null
  }
}

async function clientFor(event: H3Event) {
  const baseUrl = process.env.PERMISSIONS_URL
  if (!baseUrl) throw new Error('PERMISSIONS_URL must be set')
  const token = await getToken(event)
  if (!token) return null

  const transport = createConnectTransport({
    baseUrl,
    httpVersion: '2',
    interceptors: [bearerInterceptor(token)],
  })
  return createPromiseClient(PermissionsService, transport)
}

/**
 * Check whether the current actor may perform `action` on a project. Fail-closed:
 * returns false on missing actor / token / transport error.
 */
export async function checkProject(
  event: H3Event,
  projectId: string,
  action: ProjectAction,
): Promise<boolean> {
  const actor = getActor(event)
  if (!actor) return false
  try {
    const client = await clientFor(event)
    if (!client) return false
    const res = await client.check({
      subject: actor.sub,
      action,
      resource: projectResource(projectId),
    })
    return res.allow
  } catch {
    return false
  }
}

/**
 * Check whether the current actor holds `relation` (or higher, per the model's
 * role hierarchy) on an organization. Fail-closed.
 */
export async function checkOrg(
  event: H3Event,
  orgId: string,
  relation: OrgRelation,
): Promise<boolean> {
  const actor = getActor(event)
  if (!actor) return false
  try {
    const client = await clientFor(event)
    if (!client) return false
    const res = await client.check({
      subject: actor.sub,
      action: relation,
      resource: orgResource(orgId),
    })
    return res.allow
  } catch {
    return false
  }
}

/**
 * Batch project checks in one round-trip. Returns a map projectId→allow in the
 * same order. Any failure fails the whole batch closed (all false).
 */
export async function batchCheckProjects(
  event: H3Event,
  projectIds: string[],
  action: ProjectAction,
): Promise<Record<string, boolean>> {
  const actor = getActor(event)
  const result: Record<string, boolean> = {}
  for (const id of projectIds) result[id] = false
  if (!actor || projectIds.length === 0) return result
  try {
    const client = await clientFor(event)
    if (!client) return result
    const res = await client.batchCheck({
      checks: projectIds.map((id) => ({
        subject: actor.sub,
        action,
        resource: projectResource(id),
      })),
    })
    res.results.forEach((r, i) => {
      const id = projectIds[i]
      if (id) result[id] = r.allow
    })
    return result
  } catch {
    return result
  }
}

/**
 * List the project ids the current actor has `action` access to within the
 * JWT-scoped tenant. Returns [] on failure.
 */
export async function listAccessibleProjects(
  event: H3Event,
  action: ProjectAction,
): Promise<string[]> {
  const actor = getActor(event)
  if (!actor) return []
  try {
    const client = await clientFor(event)
    if (!client) return []
    const res = await client.listMyAccess({
      subject: actor.sub,
      resourceType: 'project',
      action,
    })
    return res.resources
  } catch {
    return []
  }
}

/**
 * Grant a project role to a subject (membership write). Used on project create
 * (creator → admin) and direct project-member invites. Throws on failure so the
 * caller can surface a 5xx rather than silently dropping the grant.
 */
export async function grantProjectRole(
  event: H3Event,
  projectId: string,
  subject: string,
  role: 'viewer' | 'editor' | 'admin',
): Promise<void> {
  const client = await clientFor(event)
  if (!client) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  await client.grantRole({
    subject: userSubject(subject),
    role,
    resource: projectResource(projectId),
  })
}

/**
 * Revoke a previously granted project role. Throws on failure.
 */
export async function revokeProjectRole(
  event: H3Event,
  projectId: string,
  subject: string,
  role: 'viewer' | 'editor' | 'admin',
): Promise<void> {
  const client = await clientFor(event)
  if (!client) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  await client.revokeRole({
    subject: userSubject(subject),
    role,
    resource: projectResource(projectId),
  })
}

/**
 * Link a project to its parent organization so org roles cascade onto the
 * project (the model's max(orgRole, projectRole)). Called once on project
 * create. Throws on failure.
 */
export async function linkProjectToOrg(
  event: H3Event,
  projectId: string,
  orgId: string,
): Promise<void> {
  const client = await clientFor(event)
  if (!client) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  await client.writeTuple({
    user: orgResource(orgId),
    relation: 'parent',
    object: projectResource(projectId),
  })
}
