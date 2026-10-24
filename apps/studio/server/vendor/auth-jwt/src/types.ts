/**
 * Verified actor derived from a KlangHaus Auth JWT.
 * `tenant` maps to the JWT `org` claim (= BetterAuth organization id).
 */
export interface AuthActor {
  sub: string
  tenant: string | null
  email?: string | undefined
}

export const AUTH_ACTOR_CONTEXT_KEY = 'authActor'

export interface AuthActorVars {
  [AUTH_ACTOR_CONTEXT_KEY]: AuthActor
}
