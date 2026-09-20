import { getRequestHeader, type H3Event } from 'h3'

// Local-only authentication bypass, so [designer] can judge the pages BEHIND
// login without an account. Decided by Allan 2026-09-20; constraints set by
// [projektleder]. It exists because studio can no longer create a user locally:
// identity lives in the central auth service, and provisioning one for a design
// review is a detour through another team.
//
// 🔴 THREE GATES, ALL REQUIRED, AND THE LAST ONE IS NOT AN ENV VAR.
//   1. NODE_ENV === 'development'
//   2. STUDIO_DEV_AUTH_BYPASS === '1'      (explicit, never implied by (1))
//   3. the request arrives on a loopback host
// (1) and (2) are deliberately independent: a development build that someone
// runs elsewhere still needs the explicit opt-in, and setting the variable in a
// non-development build does not open anything — it makes the process REFUSE TO
// START (see below). (3) is here because the first two describe the process and
// only the third describes the CALLER: a dev build reachable from another
// machine would otherwise hand that machine an admin session.
//
// 🔴 A LEAK MUST BE LOUD, NOT MERELY INERT. The obvious shape — "unless all
// gates hold, return false" — fails SILENTLY: a production deployment carrying
// STUDIO_DEV_AUTH_BYPASS=1 would look exactly like one that does not, and
// nobody would learn that the variable had escaped into an environment file.
// So the module refuses to load instead. The failure direction is declared
// here rather than discovered later: present-but-wrong-environment is an
// ERROR, absent is fine, and there is no state in between.
export const DEV_AUTH_BYPASS_MISCONFIGURED =
  'STUDIO_DEV_AUTH_BYPASS is set in a non-development build — ' +
  'this variable is a local design-review shortcut and must never reach any other environment'

export function assertBypassNotLeaked(env: NodeJS.ProcessEnv = process.env): void {
  const requested = env.STUDIO_DEV_AUTH_BYPASS
  if (requested === undefined || requested === '') return
  if (env.NODE_ENV === 'development') return
  throw new Error(`${DEV_AUTH_BYPASS_MISCONFIGURED} (NODE_ENV=${env.NODE_ENV ?? 'unset'})`)
}

assertBypassNotLeaked()

// Synthetic identity. The ids are not UUIDs on purpose: they are unmistakable
// in a log, a database row or a screenshot, so no one can confuse a seeded
// design-review row with a real one. Nothing here comes from production data.
export const DEV_BYPASS_USER = {
  id: 'dev-bypass-user-designer',
  name: 'Designer (local)',
  email: 'designer@localhost.invalid',
  emailVerified: true,
  image: null,
} as const

export const DEV_BYPASS_ORG = {
  id: 'dev-bypass-org-local',
  name: 'Local Design Review',
  slug: 'local-design-review',
  logo: null,
} as const

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Host without its port, which is the part that says WHERE the caller is. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false
  if (host.startsWith('[')) return LOOPBACK.has(host.replace(/\]:\d+$/, ']'))
  return LOOPBACK.has(host.split(':')[0]!)
}

// 🔴 THE RAW HEADER, NOT h3's getRequestHost — and the cell found this, I did
// not. `getRequestHost` DEFAULTS to the string 'localhost' when a request
// carries no Host header, so a request without one (HTTP/1.0, a raw socket, a
// proxy that strips it) read as loopback and OPENED the gate. The cell that
// listed `undefined` among the hosts that must be refused went red on exactly
// that, which is the whole reason it listed it.
//
// Reading `host` directly also means an `x-forwarded-host` cannot be presented
// as the caller's own: for a gate whose entire premise is WHERE the caller is,
// the forwarded value is a claim, not an observation.
export function requestHostHeader(event: H3Event): string | undefined {
  const host = getRequestHeader(event, 'host')
  return host && host.length > 0 ? host : undefined
}

// 🔴 `process.env['NODE_ENV']`, NOT `process.env.NODE_ENV`, AND THE BRACKETS
// ARE LICENSED BY A MEASUREMENT — do not "tidy" them away.
//
// My first version wrote the member expression, and the built server refused
// the bypass with every gate satisfied. Reading the ARTIFACT rather than the
// source explained it: the bundler substitutes that exact expression at build
// time, and the whole function had been folded to
//
//   function devAuthBypassEnabled(event) {  return false;  }
//
// I first read that as a bonus — "a production build cannot even contain the
// bypass" — and rebuilt with NODE_ENV=development to get the designer's copy.
// It compiled to `return false` AGAIN. `nuxt build` pins the value to
// 'production' regardless of the ambient environment, so the folding is not a
// production-only protection at all: it removes the gate from EVERY build, and
// the compile-time read can never be true in a built server. Two measurements
// on two artifacts, not one generalised from the other.
//
// So NODE_ENV is read at RUNTIME here, in the one form the bundler leaves
// alone. Its protective weight moves to `assertBypassNotLeaked` above, which
// survives the build intact (verified in the same bundle) and kills a process
// that carries the variable outside development — a deployment that cannot
// start is a louder guard than a branch that quietly returns false.
export function devAuthBypassEnabled(event: H3Event): boolean {
  if (process.env['NODE_ENV'] !== 'development') return false
  if (process.env['STUDIO_DEV_AUTH_BYPASS'] !== '1') return false
  return isLoopbackHost(requestHostHeader(event))
}

/**
 * True only for the bypass's OWN synthetic subject.
 *
 * 🔴 THE SUBJECT CHECK IS NOT REDUNDANT WITH THE THREE GATES, and it is the
 * difference between a shortcut and a hole. The permission layer (server/lib/pdp)
 * is the REAL boundary — `middleware/auth-decision.ts` says so in its own header:
 * the routing decision shapes where a visitor is sent, the PDP decides what they
 * may obtain. Granting there needs a narrower question than "is the bypass on":
 * it must grant to the fictional reviewer and to nobody else. Without this, a
 * local server that somehow saw a REAL session would hand that real user every
 * permission in the product. With it, the worst case is that a made-up user with
 * no data of its own is allowed to look at a made-up organization.
 */
export function isDevBypassSubject(event: H3Event, subject: string | undefined): boolean {
  return devAuthBypassEnabled(event) && subject === DEV_BYPASS_USER.id
}
