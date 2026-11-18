import { getCookie, type H3Event } from 'h3'
import { oidcSessionCookie, readOidcConfig } from './config'
import { resolveSession } from './sessions'

export interface OidcActor {
  sub: string
  tenant: string | null
  email?: string
}

/**
 * The actor for a request in AUTH_MODE=oidc, from the session cookie, or null.
 * Loaded lazily by the auth middleware so that nothing here (and so no
 * database connection) is touched in better-auth mode.
 */
export async function authenticateOidcSession(event: H3Event): Promise<OidcActor | null> {
  const cfg = readOidcConfig()
  const token = getCookie(event, oidcSessionCookie(cfg).name)
  if (!token) return null
  const { db } = await import('~~/server/db')
  try {
    const user = await resolveSession(db, cfg, token)
    if (!user) return null
    return {
      sub: user.userId,
      tenant: user.activeOrganizationId,
      ...(user.email ? { email: user.email } : {}),
    }
  } catch (err) {
    // A database failure is not "signed out" for the user, but this layer only
    // decides who the actor is: nothing is granted, and the route guards answer.
    console.error('[oidc] session lookup failed:', (err as Error).message)
    return null
  }
}
