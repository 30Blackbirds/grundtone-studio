// A deployment choice that studio must be TOLD, never guess:
//
//   AUTHORIZER       'pdp' | 'local'   who decides access (see authorizer.ts)
//
// 🔴 WHY THERE IS NO DEFAULT. AUTHORIZER picks the security boundary. A default
// would make that choice silently for every deployment that forgot the
// variable, and either default is wrong for someone: 'pdp' breaks a self-hosted
// install that has no permissions service, 'local' makes an existing install
// decide from an empty org_member table.
//
// So a missing or unknown value is a refusal to start (server/plugins/
// assert-runtime-flags.ts) and a refusal to answer at request time. Unlike
// cdn-base-required.ts there is no NODE_ENV exemption: a dev machine and a test
// run must name their choice too (vitest.config.ts sets it to today's
// production value). A layer with its own required switch uses
// parseRuntimeFlag for the same rule and message.

export const AUTHORIZER_KINDS = ['pdp', 'local'] as const
export type AuthorizerKind = (typeof AUTHORIZER_KINDS)[number]

export class RuntimeFlagError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeFlagError'
  }
}

export function parseRuntimeFlag<T extends string>(
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

export function authorizerKind(value: string | undefined): AuthorizerKind {
  return parseRuntimeFlag(
    'AUTHORIZER',
    value,
    AUTHORIZER_KINDS,
    "'pdp' asks the permissions service, 'local' decides from studio's own database.",
  )
}

/** The boot check: refuses to start without a valid AUTHORIZER. */
export function assertRuntimeFlags(env: NodeJS.ProcessEnv = process.env): void {
  authorizerKind(env.AUTHORIZER)
}
