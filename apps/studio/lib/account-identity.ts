// Who the account pages show, from whichever identity source this deployment
// uses. Pure, so the rule is testable without Nuxt.
//
//   better-auth  the Better Auth session (unchanged behaviour)
//   oidc         the claim Studio stored at login (app_user.email_verified),
//                refreshed at every login. Verifying the address is the IdP's
//                job, so there is no "resend" and no change-email form here.

export type AuthMode = 'better-auth' | 'oidc'

interface SessionUserLike {
  email?: string | null
  emailVerified?: boolean | null
}

export interface AccountIdentity {
  mode: AuthMode
  loaded: boolean
  email: string
  emailVerified: boolean
  /** The IdP, not Studio, owns the address: hide resend / change-email. */
  managedByIdp: boolean
}

export function resolveAccountIdentity(input: {
  mode: AuthMode
  betterAuth: { pending?: boolean; user?: SessionUserLike | null }
  oidc: { loaded: boolean; user?: SessionUserLike | null }
}): AccountIdentity {
  if (input.mode === 'oidc') {
    const u = input.oidc.user
    return {
      mode: 'oidc',
      loaded: input.oidc.loaded,
      email: u?.email ?? '',
      // Only an explicit true counts, as for the Better Auth session.
      emailVerified: u?.emailVerified === true,
      managedByIdp: true,
    }
  }
  const u = input.betterAuth.user
  return {
    mode: 'better-auth',
    loaded: input.betterAuth.pending !== true,
    email: u?.email ?? '',
    emailVerified: u?.emailVerified === true,
    managedByIdp: false,
  }
}
