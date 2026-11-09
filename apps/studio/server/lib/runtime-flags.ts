import { createError } from 'h3'

// Two deployment choices that studio must be TOLD, never guess:
//
//   AUTHORIZER       'pdp' | 'local'   who decides access (see authorizer.ts)
//   FEATURE_BILLING  'on'  | 'off'     whether the billing surface exists
//
// 🔴 WHY THERE IS NO DEFAULT. AUTHORIZER picks the security boundary. A default
// would make that choice silently for every deployment that forgot the
// variable, and either default is wrong for someone: 'pdp' breaks a self-hosted
// install that has no permissions service, 'local' makes an existing install
// decide from an empty org_member table. FEATURE_BILLING follows the same rule,
// because "billing is on" with no account service behind it is a checkout page
// that fails at the last step.
//
// So a missing or unknown value is a refusal to start (server/plugins/
// assert-runtime-flags.ts) and a refusal to answer at request time. Unlike
// cdn-base-required.ts there is no NODE_ENV exemption: a dev machine and a test
// run must name their choice too (vitest.config.ts sets both to today's
// production values).

export const AUTHORIZER_KINDS = ['pdp', 'local'] as const
export type AuthorizerKind = (typeof AUTHORIZER_KINDS)[number]

export const BILLING_STATES = ['on', 'off'] as const
export type BillingState = (typeof BILLING_STATES)[number]

export class RuntimeFlagError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeFlagError'
  }
}

function parse<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  consequence: string,
): T {
  if ((allowed as readonly string[]).includes(value ?? '')) return value as T
  const got = value === undefined ? 'unset' : `${JSON.stringify(value)}`
  throw new RuntimeFlagError(
    `refusing to start: ${name} is ${got}; set it to one of ${allowed.join(' | ')}. ${consequence}`,
  )
}

// 🔴 The value is a REQUIRED argument, read from the environment by the caller.
// A default parameter (`value = process.env.X`) would turn an explicit
// `undefined` into whatever the process has, and assertRuntimeFlags({}) would
// then pass on the test runner's own variables: the check would measure the
// wrong object.
export function authorizerKind(value: string | undefined): AuthorizerKind {
  return parse(
    'AUTHORIZER',
    value,
    AUTHORIZER_KINDS,
    "'pdp' asks the permissions service, 'local' decides from studio's own database.",
  )
}

export function billingState(value: string | undefined): BillingState {
  return parse(
    'FEATURE_BILLING',
    value,
    BILLING_STATES,
    "'off' removes checkout, the billing page and the brand-count reconcile.",
  )
}

/** Request time: reads FEATURE_BILLING from this process's environment. */
export function billingEnabled(): boolean {
  return billingState(process.env.FEATURE_BILLING) === 'on'
}

/** Both flags at once, so a deployment learns about every missing value in one start. */
export function assertRuntimeFlags(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = []
  for (const check of [
    () => authorizerKind(env.AUTHORIZER),
    () => billingState(env.FEATURE_BILLING),
  ]) {
    try {
      check()
    } catch (err) {
      errors.push((err as Error).message)
    }
  }
  if (errors.length > 0) throw new RuntimeFlagError(errors.join('\n'))
}

/**
 * Billing routes call this first. With FEATURE_BILLING=off they answer 404: the
 * route does not exist in this deployment, which is different from "you may
 * not" (403) or "account is down" (503).
 */
export function requireBillingEnabled(): void {
  if (billingEnabled()) return
  throw createError({
    statusCode: 404,
    statusMessage: 'Billing is not enabled in this deployment',
    data: { code: 'billing_off' },
  })
}
