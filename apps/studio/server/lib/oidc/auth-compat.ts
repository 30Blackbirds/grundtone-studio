import { createError, deleteCookie, getCookie, getQuery, readBody, type H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { orgInvitation } from '~~/server/db/schema'
import { stubKeyFor } from '../dev-auth-stub'
import { assertSameOrigin } from '../org-membership-input'
import { oidcSessionCookie, readOidcConfig } from './config'
import { destroySession, resolveSession } from './sessions'

// The browser's org and session reads, answered from Studio's own tables.
//
// The pages behind login call /api/auth/** (get-session, organization/list,
// organization/get-full-organization, ...) through the Better Auth client. In
// AUTH_MODE=oidc there is no auth service behind that path, so the same seam
// answers them locally, in the shapes the client already expects. Everything is
// scoped to the caller's own session; a path not listed here is refused rather
// than proxied anywhere.

const MEMBER_PAGE = 200
const UUID = /^[0-9a-f-]{36}$/i

function unsupported(key: string): never {
  throw createError({
    statusCode: 501,
    statusMessage: `${key} is not available when sign-in is handled by an external identity provider`,
    data: { code: 'not_supported_in_oidc_mode' },
  })
}

async function stores() {
  const [{ db }, orgs, lookup] = await Promise.all([
    import('~~/server/db'),
    import('../local-orgs'),
    import('../org-lookup'),
  ])
  return { db, orgs, lookup }
}

function actorOf(event: H3Event) {
  const a = event.context.auth
  if (!a || a.sub.startsWith('machine:')) throw createError({ statusCode: 401 })
  return { id: a.sub, email: a.email ?? null }
}

export async function answerOidcAuthPath(event: H3Event): Promise<unknown> {
  const key = stubKeyFor(event.path)
  const method = event.method

  if (key === 'get-session' && method === 'GET') {
    const cfg = readOidcConfig()
    const { db } = await stores()
    const u = await resolveSession(db, cfg, getCookie(event, oidcSessionCookie(cfg).name))
    if (!u) return null
    return {
      session: { id: u.userId, userId: u.userId, activeOrganizationId: u.activeOrganizationId },
      user: {
        id: u.userId,
        email: u.email,
        emailVerified: u.emailVerified,
        name: u.name ?? u.email ?? '',
        image: null,
      },
    }
  }

  if (key === 'sign-out' && method === 'POST') {
    assertSameOrigin(event)
    const cfg = readOidcConfig()
    const cookie = oidcSessionCookie(cfg)
    const { db } = await stores()
    await destroySession(db, getCookie(event, cookie.name))
    deleteCookie(event, cookie.name, { path: '/', secure: cookie.secure })
    return { success: true }
  }

  if (key === 'organization/list' && method === 'GET') {
    actorOf(event)
    return (await stores()).lookup.listCallerOrgs(event)
  }

  if (key === 'organization/get-full-organization' && method === 'GET') {
    actorOf(event)
    const q = getQuery(event)
    const { lookup } = await stores()
    if (typeof q.organizationSlug === 'string')
      return lookup.lookupOrgBySlug(event, q.organizationSlug)
    if (typeof q.organizationId === 'string') return lookup.lookupOrgById(event, q.organizationId)
    throw createError({ statusCode: 400 })
  }

  if (key === 'organization/list-members' && method === 'GET') {
    const actor = actorOf(event)
    const id = getQuery(event).organizationId
    if (typeof id !== 'string') throw createError({ statusCode: 400 })
    const { db, orgs } = await stores()
    try {
      const rows = await orgs.listMembers(db, actor, id)
      const members = rows.slice(0, MEMBER_PAGE).map((m) => ({
        id: m.userId,
        userId: m.userId,
        organizationId: id,
        role: m.role,
        user: { id: m.userId, email: m.email, name: m.name ?? m.email ?? '', image: null },
      }))
      return { members, total: rows.length }
    } catch (err) {
      return refuse(err)
    }
  }

  if (key === 'organization/list-invitations' && method === 'GET') {
    const actor = actorOf(event)
    const id = getQuery(event).organizationId
    if (typeof id !== 'string') throw createError({ statusCode: 400 })
    const { db, orgs } = await stores()
    try {
      return (await orgs.listInvitations(db, actor, id)).map((i) => ({
        ...i,
        organizationId: id,
        status: 'pending',
      }))
    } catch (err) {
      return refuse(err)
    }
  }

  if (key === 'organization/set-active' && method === 'POST') {
    // The active organisation is the URL in Studio; nothing is stored per session.
    actorOf(event)
    return {}
  }

  if (key === 'organization/cancel-invitation' && method === 'POST') {
    assertSameOrigin(event)
    const actor = actorOf(event)
    const body = (await readBody(event)) as { invitationId?: unknown } | null
    const invitationId = body?.invitationId
    if (typeof invitationId !== 'string' || !UUID.test(invitationId))
      throw createError({ statusCode: 400 })
    const { db, orgs } = await stores()
    // The org is read from the row, then the store decides on the caller's
    // role in THAT org; a missing row and a forbidden one both read as not found.
    const [row] = await db
      .select({ organizationId: orgInvitation.organizationId })
      .from(orgInvitation)
      .where(and(eq(orgInvitation.id, invitationId), isNull(orgInvitation.acceptedAt)))
      .limit(1)
    if (!row) throw createError({ statusCode: 404 })
    try {
      await orgs.revokeInvitation(db, actor, row.organizationId, invitationId)
      return { ok: true }
    } catch (err) {
      return refuse(err)
    }
  }

  return unsupported(key)
}

async function refuse(err: unknown): Promise<never> {
  const { toHttp } = await import('../org-membership-local')
  throw toHttp(err)
}
