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
//   3. the connection's PEER ADDRESS is loopback (and its Host agrees), OR the
//      request is Nitro's own internal SSR fetch, which has no peer — and that
//      exception is only safe because of gate 4
//   4. the request was not made BY A PAGE belonging to someone else
//      (Sec-Fetch-Site) — gates 3 and 4 answer "which machine", this answers
//      "which page", and a hostile tab in the reviewer's own browser is on the
//      right machine
//   5. the process REFUSES TO START unless it listens on loopback
//      (assertBypassBindsLoopback). Gates 3 and 4 are load-bearing TOGETHER:
//      drop 4 and a LAN visitor's page render would inherit the bypass through
//      its own internal fetch.
// (1) and (2) are deliberately independent: a development build that someone
// runs elsewhere still needs the explicit opt-in, and setting the variable in a
// non-development build does not open anything — it makes the process REFUSE TO
// START (see below). (3) is here because the first two describe the process and
// only the third describes the CALLER: a dev build reachable from another
// machine would otherwise hand that machine an admin session.
//
// 🔴 THE LOAD-BEARING ASSUMPTION, NAMED BECAUSE IT IS NOT ENFORCED FROM HERE:
// this module must be INCLUDED IN and LOADED BY the production bundle, or
// `assertBypassNotLeaked` never runs and the leak state goes silent again —
// precisely the state the assertion exists to prevent. It holds today only
// because `server/middleware/auth.ts` imports the module unconditionally, and
// Nitro loads every server middleware at startup. Measured on the built server
// (nitro.mjs): the assertion is present verbatim and `assertBypassNotLeaked()`
// is called at module scope, and a production build carrying the variable
// refuses to boot. If someone ever makes that import conditional or lazy, this
// guard stops existing without a single test going red.
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

export const DEV_AUTH_BYPASS_NOT_LOOPBACK_BOUND =
  'STUDIO_DEV_AUTH_BYPASS=1 requires HOST (or NITRO_HOST) to be a loopback address — ' +
  'refusing to start a bypassed server that other machines can reach'

/**
 * 🔴 THE BYPASS MAY ONLY RUN ON A SERVER NOBODY ELSE CAN REACH, and this
 * assertion is what turns that from an assumption into a fact.
 *
 * [sikkerhed] named the assumption on #292: what I called the real protection —
 * "the server is only bound locally" — was asserted nowhere, in a codebase that
 * otherwise asserts its assumptions and kills the process when they break. And
 * Nitro's default bind is `0.0.0.0`, so it was not even the likely case.
 *
 * It carries weight the per-request gate cannot: an internal SSR fetch has no
 * peer address to check (see `isInternalRequest`), so the guarantee that the
 * page render was asked for by a local caller must come from the LISTENER, not
 * from the child request. A positively declared loopback HOST is that guarantee
 * — the port opens only for a value someone stated, never by default.
 */
export function assertBypassBindsLoopback(env: NodeJS.ProcessEnv = process.env): void {
  if (env.STUDIO_DEV_AUTH_BYPASS !== '1') return
  const host = env.HOST ?? env.NITRO_HOST
  if (host === 'localhost' || isLoopbackAddress(host)) return
  throw new Error(`${DEV_AUTH_BYPASS_NOT_LOOPBACK_BOUND} (HOST=${host ?? 'unset'})`)
}

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

// The whole 127.0.0.0/8 range, not just 127.0.0.1 — `127.0.0.2` and the
// IPv4-mapped form a dual-stack listener reports are loopback too.
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/

/**
 * Is this ADDRESS on the loopback interface? Used for the socket's peer
 * address, which the caller cannot choose.
 *
 * 🔴 `::ffff:127.0.0.1` IS NOT AN EDGE CASE HERE — it is the ORDINARY form.
 * A Node server listening on `::` reports IPv4 peers in the IPv4-mapped IPv6
 * notation, so a plain `curl http://127.0.0.1:3024` arrives as
 * `::ffff:127.0.0.1`. Omitting it would have refused the only shape the
 * feature is used in, and the failure would have looked like the gate working.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  let a = address.trim().toLowerCase()
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1)
  if (a === '::1') return true
  if (a.startsWith('::ffff:')) return LOOPBACK_V4.test(a.slice('::ffff:'.length))
  return LOOPBACK_V4.test(a)
}

/**
 * Host without its port — a CLAIM about where the caller is (see the gate).
 *
 * 🔴 THE BARE-`::1` BRANCH WAS DEAD CODE, found by [sikkerhed] running the
 * predicate rather than reading it: `'::1'.split(':')[0]` is `''`, so the set
 * member `'::1'` could never be reached and only the bracketed form worked.
 * A dead accept is a false negative — it would have refused a legitimate
 * caller and looked like the gate doing its job. Hostnames are also
 * case-insensitive and may carry a fully-qualified trailing dot, so `LOCALHOST`
 * and `localhost.` are the same host and are now treated as such.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false
  let h = host.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    if (end === -1) return false
    h = h.slice(1, end)
  } else if (h.split(':').length > 2) {
    // A bare IPv6 host, unbracketed: the whole string is the address.
  } else {
    h = h.split(':')[0]!
  }
  h = h.replace(/\.$/, '')
  if (h === 'localhost') return true
  return isLoopbackAddress(h)
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

/**
 * The peer address of the TCP connection — the one fact about a request the
 * caller cannot write. `undefined` when there is no socket, which must read as
 * "not loopback" rather than as "probably local".
 */
export function requestRemoteAddress(event: H3Event): string | undefined {
  const address = event.node?.req?.socket?.remoteAddress
  return address && address.length > 0 ? address : undefined
}

/**
 * Is this event Nitro's own internal fetch rather than something off the wire?
 *
 * 🔴 WHY IT HAD TO EXIST, and it is a defect the socket gate introduced.
 * Measured on the built server with a probe, because guessing the shape of an
 * internal event is exactly the kind of thing that produces a plausible wrong
 * answer:
 *
 *   /dashboard      hasSocket: true, remote: "::1", reqKeys: [... socket ...]
 *   /api/dashboard  hasSocket: true, remote: "",    reqKeys: [... __unenv__ ...]
 *
 * The second is the SSR data fetch the page makes about itself. It is not a TCP
 * connection, so it has no peer address — `remoteAddress` is the EMPTY STRING,
 * not undefined — and the socket gate denied it. The endpoint answered 401, the
 * dashboard's org list came back empty, and `onMounted` then sent the visitor
 * to /onboarding because "this user has no organizations". [designer] found it
 * on a HARD LOAD; client-side navigation is a real request with a real socket,
 * which is why my own verification missed it: I measured the hydrated DOM, not
 * what the server sent.
 *
 * `__unenv__` is the marker because it is a property of the server's own mock
 * request object. A client cannot forge it: nothing from the wire reaches this
 * field, and headers and query are not consulted — an HTTP header of that name
 * lands in `req.headers`, never as `'__unenv__' in req`, and three cells pin
 * exactly that distinction.
 *
 * 🔴 THE RUNTIME ASSUMPTION, NAMED BECAUSE THIS FILE OTHERWISE ASSERTS ITS OWN
 * ([sikkerhed], #294): the marker's discriminating power is a property of the
 * RUNTIME, not of the request. unenv polyfills `node:http` for non-Node
 * presets, where EVERY request object could be unenv-shaped and the marker
 * would stop separating anything. Under studio's Node preset it is absent for
 * real requests — measured on the built server — but nothing here enforces the
 * preset. Change the Nitro preset and this check must be re-measured, not
 * assumed to have survived.
 *
 * 🔴 AND BEING INTERNAL IS NOT ENOUGH ON ITS OWN. A LAN visitor loading
 * /dashboard would produce an internal child fetch too, and allowing every
 * internal request would hand them the data the parent request was refused.
 * What closes that is `assertBypassBindsLoopback`: with the bypass on, the
 * process refuses to start unless it listens on loopback, so there is no LAN
 * visitor to inherit anything. The two guards are load-bearing TOGETHER —
 * remove the bind assertion and this one becomes a hole.
 */
export function isInternalRequest(event: H3Event): boolean {
  const req = event.node?.req as unknown as Record<string, unknown> | undefined
  return Boolean(req && '__unenv__' in req)
}

/**
 * Sec-Fetch-Site values that mean "this request did not come from a page
 * belonging to someone else".
 *
 * 🔴 THE GATE WAS TRUE FOR THE NETWORK AND FALSE FOR THE BROWSER, found by
 * [sikkerhed] after #294 — they went looking for who ELSE sits on loopback.
 * Gate 4 keeps strangers off the listener, but a hostile page open in the
 * REVIEWER'S OWN browser is not a stranger to it: the browser sends from their
 * machine, so the peer address is loopback, the Host is loopback, and the
 * bypass needs no cookie. The endpoint then runs as the bypass user. The
 * response cannot be read cross-origin (there are no CORS headers, and that is
 * deliberate), but THE WRITE LANDS — and form posts and GETs with side effects
 * need no preflight.
 *
 * It is worse than ordinary CSRF: normally the attack needs the victim to hold
 * a session. Here the ORIGIN IS the session, so every tab in that browser is
 * authenticated.
 *
 * `Sec-Fetch-Site` is the right instrument because a script cannot set it —
 * `Sec-` is a forbidden header prefix, enforced by the browser, not by us. A
 * non-browser client (curl, the SSR fetch) omits it entirely, which reads as
 * "no page made this request".
 *
 * 🔴 STRICTER THAN THE ONE-LINE CURE, ON PURPOSE. [sikkerhed] proposed
 * rejecting `cross-site`. That leaves `same-site`, and on localhost that is not
 * empty: origins differing only by PORT are same-site but not same-origin, so a
 * hostile page on `http://localhost:9999` would have slipped through. Allowing
 * only `same-origin` and `none` (a user-typed navigation) closes it, and the
 * app's own requests are same-origin by construction — measured end to end
 * after the change, not assumed.
 */
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none'])

export function isSameOriginRequest(event: H3Event): boolean {
  const site = getRequestHeader(event, 'sec-fetch-site')
  if (!site) return true
  return ALLOWED_FETCH_SITES.has(site.trim().toLowerCase())
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
// 🔴 THE THIRD GATE IS THE SOCKET, NOT THE HOST HEADER — and [sikkerhed] had to
// tell me, using an argument that was already written four lines up in this
// file. I wrote, about x-forwarded-host: "for a gate whose entire premise is
// WHERE the caller is, the forwarded value is a claim, not an observation."
// That is true of `Host` ITSELF. Host is chosen by the client, so the first
// version of this gate asked the caller where it was and believed the answer:
//
//   curl -H 'Host: localhost' http://<the-machine-on-the-LAN>:3024/...
//
// no proxy required. Calibrated, so nobody reads it larger than it is: it needs
// NODE_ENV=development AND the explicit variable AND the server reachable from
// another machine. Not a production hole — a LAN hole on the reviewer's own
// machine, in exactly the window the feature exists for.
//
// `socket.remoteAddress` is the one fact in a request the caller cannot write.
// The Host check STAYS, as a second layer and because it costs nothing; the
// order below is deliberate: observation first, claim second.
//
// I had even named this risk in my own message — "a proxy that sets Host on
// behalf of a stranger" — and then left it open. Naming a hazard is not closing
// it.
// Runs at module load, next to the leak assertion: the two together are what
// let an internal request be trusted at all.
assertBypassBindsLoopback()

export function devAuthBypassEnabled(event: H3Event): boolean {
  if (process.env['NODE_ENV'] !== 'development') return false
  if (process.env['STUDIO_DEV_AUTH_BYPASS'] !== '1') return false
  // Nitro's own SSR fetch has no peer to observe; the listener is what
  // guarantees locality there (assertBypassBindsLoopback). Everything off the
  // wire must still prove where it came from.
  // A page belonging to someone else must not be able to act as the reviewer,
  // even from their own machine. Checked BEFORE the internal shortcut so the
  // ordering cannot be read as "internal wins".
  if (!isSameOriginRequest(event)) return false
  if (isInternalRequest(event)) return true
  if (!isLoopbackAddress(requestRemoteAddress(event))) return false
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
