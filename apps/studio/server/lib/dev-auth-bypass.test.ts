import { afterEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import {
  DEV_BYPASS_USER,
  isDevBypassSubject,
  assertBypassNotLeaked,
  DEV_AUTH_BYPASS_MISCONFIGURED,
  devAuthBypassEnabled,
  isLoopbackHost,
  isLoopbackAddress,
  isInternalRequest,
  isSameOriginRequest,
  requestRemoteAddress,
  assertBypassBindsLoopback,
  DEV_AUTH_BYPASS_NOT_LOOPBACK_BOUND,
} from './dev-auth-bypass'

// Riff: the local design-review bypass. These cells exist for one reason —
// every one of them describes a way the bypass could open somewhere it must
// not. A green here is not "the feature works"; it is "each gate still refuses
// on its own".

// The default remote address is the IPv4-mapped form a dual-stack Node server
// actually reports for `curl http://127.0.0.1:3024`, not the tidy '127.0.0.1'
// one would write from memory.
// 🔴 `null` MEANS "NO SOCKET", NOT `undefined` — because passing `undefined`
// explicitly triggers a DEFAULT PARAMETER, which is exactly how the first
// version of the no-socket cell tested the happy path while claiming to test
// its absence. It went red only because the gate was already correct; with the
// directions reversed it would have been a silent false green.
const eventFrom = (host: string | undefined, remoteAddress: string | null = '::ffff:127.0.0.1') =>
  ({
    node: {
      req: {
        headers: host === undefined ? {} : { host },
        socket: { remoteAddress: remoteAddress ?? undefined },
      },
    },
    headers: new Headers(host === undefined ? {} : { host }),
  }) as unknown as H3Event

const eventWithHost = (host: string | undefined) => eventFrom(host)

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
  vi.unstubAllEnvs()
})

describe('the three gates', () => {
  it('opens only when all three hold', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(eventWithHost('localhost:3020'))).toBe(true)
  })

  // 🔴 EACH GATE ALONE. Written as three separate expectations rather than one
  // loop over a table, because the interesting claim is that removing ANY ONE
  // closes it — a table that shared a bug would pass all three rows together.
  it('closes when NODE_ENV is not development, even with the variable set', () => {
    process.env.NODE_ENV = 'production'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(eventWithHost('localhost:3020'))).toBe(false)
  })

  it('closes in development when the variable is absent', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.STUDIO_DEV_AUTH_BYPASS
    expect(devAuthBypassEnabled(eventWithHost('localhost:3020'))).toBe(false)
  })

  it('closes for a caller that is not on loopback, however the process is configured', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    for (const host of [
      'studio.grundtone.com',
      '192.168.1.40:3020',
      'localhost.evil.example',
      'notlocalhost',
      undefined,
    ]) {
      expect(devAuthBypassEnabled(eventWithHost(host)), String(host)).toBe(false)
    }
  })

  // The positive control for the cell above: without it, a host check that
  // rejected EVERYTHING would look like a perfect guard.
  it('accepts the loopback spellings a browser actually sends', () => {
    for (const host of ['localhost', 'localhost:3020', '127.0.0.1:3020', '[::1]:3020']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
  })

  it('does not accept a host that merely starts with a loopback name', () => {
    expect(isLoopbackHost('localhost.attacker.example')).toBe(false)
    expect(isLoopbackHost('127.0.0.1.attacker.example')).toBe(false)
  })

  // 🔴 THE CELL FOR [sikkerhed]'s FINDING, and it is the whole reason the gate
  // reads a socket at all. Host is a header the CLIENT chooses, so the previous
  // version asked the caller where it was and believed the answer:
  //
  //   curl -H 'Host: localhost' http://<a-machine-on-the-LAN>:3024/...
  //
  // no proxy needed. This request must be denied on the ADDRESS, whatever the
  // header says.
  it('denies a request from a non-loopback socket even when it claims Host: localhost', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    for (const remote of ['192.168.1.40', '10.0.0.7', '2001:db8::1', '::ffff:192.168.1.40']) {
      expect(
        devAuthBypassEnabled(eventFrom('localhost:3024', remote)),
        `Host: localhost from ${remote}`,
      ).toBe(false)
    }
  })

  // The positive control for the cell above: a gate that denied every address
  // would pass it while making the feature unusable.
  it('accepts the loopback peer addresses a real server reports', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.2']) {
      expect(devAuthBypassEnabled(eventFrom('localhost:3024', remote)), remote).toBe(true)
    }
  })

  it('denies when there is no socket to observe — absence is not "probably local"', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(eventFrom('localhost:3024', null))).toBe(false)
  })

  // The Host check survives as a SECOND layer; this pins that it still refuses.
  it('still denies a foreign Host from a loopback socket, so the second layer stays', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(eventFrom('studio.grundtone.com', '127.0.0.1'))).toBe(false)
  })

  // 🔴 THE DEAD SET MEMBER [sikkerhed] FOUND BY RUNNING THE PREDICATE. A dead
  // ACCEPT is a false negative: it refuses a legitimate caller and looks like
  // the gate working, which is why no other cell noticed it.
  it('accepts the loopback spellings that were dead or missing before', () => {
    for (const host of ['::1', '[::1]', '[::1]:3024', 'LOCALHOST', 'localhost.', '127.0.0.2']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
  })

  it('separates the address predicate from the host predicate', () => {
    // 'localhost' is a HOST, never an address: an address predicate that
    // accepted it would be reading a name as an observation.
    expect(isLoopbackAddress('localhost')).toBe(false)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::ffff:192.168.1.40')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})

// 🔴 THE PERMISSION GRANT IS NARROWER THAN THE GATE, and these cells are the
// reason it is safe to touch server/lib/pdp at all. The gates say the PROCESS
// and the CALLER are local; this says the SUBJECT is the fictional reviewer.
// Without the subject check, a local server that somehow saw a real session
// would grant that real user every permission in the product.
describe('the permission grant', () => {
  it('allows the bypass user when the gates are open', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(isDevBypassSubject(eventWithHost('localhost:3020'), DEV_BYPASS_USER.id)).toBe(true)
  })

  it('refuses every other subject, gates open or not', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    for (const subject of [
      'a-real-central-auth-user-id',
      DEV_BYPASS_USER.id.toUpperCase(),
      `${DEV_BYPASS_USER.id}-2`,
      '',
      undefined,
    ]) {
      expect(isDevBypassSubject(eventWithHost('localhost:3020'), subject), String(subject)).toBe(
        false,
      )
    }
  })

  it('refuses the bypass user when any gate is closed', () => {
    process.env.NODE_ENV = 'production'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(isDevBypassSubject(eventWithHost('localhost:3020'), DEV_BYPASS_USER.id)).toBe(false)

    process.env.NODE_ENV = 'development'
    expect(isDevBypassSubject(eventWithHost('studio.grundtone.com'), DEV_BYPASS_USER.id)).toBe(
      false,
    )
  })
})

// 🔴 THE LEAK MUST BE LOUD. A bypass variable that reached a non-development
// build and was merely IGNORED would leave no trace: the deployment would look
// identical to one where it never escaped. The assertion below is what makes
// that case a failure instead of a silence, and the cells assert on the
// MESSAGE, because that is what a person reads at 03:00, not an exit code.
describe('the leak assertion', () => {
  it('refuses a non-development environment that carries the variable', () => {
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'production', STUDIO_DEV_AUTH_BYPASS: '1' }),
    ).toThrow(DEV_AUTH_BYPASS_MISCONFIGURED)
  })

  it('names the environment it found, so the message is actionable', () => {
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'staging', STUDIO_DEV_AUTH_BYPASS: '1' }),
    ).toThrow(/NODE_ENV=staging/)
  })

  it('refuses when NODE_ENV is unset entirely — the ambiguous case must not pass', () => {
    expect(() => assertBypassNotLeaked({ STUDIO_DEV_AUTH_BYPASS: '1' })).toThrow(/NODE_ENV=unset/)
  })

  it('refuses any truthy-looking value, not just the one that enables it', () => {
    // `true`, `yes` and `0` do not switch the bypass ON — but their presence in
    // a production environment file is the same accident, and pretending
    // otherwise would make the guard depend on the exact spelling someone used.
    for (const value of ['true', 'yes', '0', 'false']) {
      expect(() =>
        assertBypassNotLeaked({ NODE_ENV: 'production', STUDIO_DEV_AUTH_BYPASS: value }),
      ).toThrow(DEV_AUTH_BYPASS_MISCONFIGURED)
    }
  })

  // The other direction, and the one that keeps this from being a nuisance: an
  // environment without the variable must be silent.
  it('is silent when the variable is absent or empty', () => {
    expect(() => assertBypassNotLeaked({ NODE_ENV: 'production' })).not.toThrow()
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'production', STUDIO_DEV_AUTH_BYPASS: '' }),
    ).not.toThrow()
    expect(() =>
      assertBypassNotLeaked({ NODE_ENV: 'development', STUDIO_DEV_AUTH_BYPASS: '1' }),
    ).not.toThrow()
  })
})

// 🔴 THE INTERNAL SSR FETCH, and the defect the socket gate introduced.
// Measured with a probe on the BUILT server, because the shape of an internal
// event is exactly the thing one would otherwise guess wrong:
//   /dashboard      remote "::1", no __unenv__     (a real request)
//   /api/dashboard  remote "",    has __unenv__    (the page fetching itself)
// The empty string is why the socket gate denied it: it is not undefined, and
// it is not an address either.
describe('the internal SSR fetch', () => {
  const internal = (host: string | undefined = 'localhost:3024') =>
    ({
      node: {
        req: { headers: host ? { host } : {}, socket: { remoteAddress: '' }, __unenv__: {} },
      },
      headers: new Headers(host ? { host } : {}),
    }) as unknown as H3Event

  it('is recognised by a marker the HTTP layer never sets from the wire', () => {
    expect(isInternalRequest(internal())).toBe(true)
    expect(isInternalRequest(eventFrom('localhost:3024', '127.0.0.1'))).toBe(false)
  })

  // 🔴 THE EMPTY STRING IS THE POINT, and it has its own cell so nobody
  // "tidies" it into undefined later. An internal event's remoteAddress is
  // `''` — not missing, not an address. `requestRemoteAddress` normalises it to
  // undefined, which is why the socket gate refused it and why the marker, not
  // the address, has to decide this case.
  it('reports an EMPTY remote address, not a missing one', () => {
    const e = internal()
    expect(
      (e as unknown as { node: { req: { socket: { remoteAddress: string } } } }).node.req.socket
        .remoteAddress,
    ).toBe('')
    expect(requestRemoteAddress(e)).toBeUndefined()
    expect(isLoopbackAddress('')).toBe(false)
  })

  it('is allowed, because the page it renders was already gated at the listener', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(internal())).toBe(true)
  })

  it('still needs the environment gates — internal is not a master key', () => {
    process.env.NODE_ENV = 'production'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(internal())).toBe(false)

    process.env.NODE_ENV = 'development'
    delete process.env.STUDIO_DEV_AUTH_BYPASS
    expect(devAuthBypassEnabled(internal())).toBe(false)
  })

  // 🔴 A CLIENT MUST NOT BE ABLE TO CLAIM IT. The marker is a property of the
  // server's own mock request object; nothing from the wire reaches it. These
  // are the shapes an attacker controls.
  it('cannot be claimed from the wire', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    const forged = (headers: Record<string, string>) =>
      ({
        node: { req: { headers, socket: { remoteAddress: '192.168.1.40' } } },
        headers: new Headers(headers),
      }) as unknown as H3Event
    const attempts: Record<string, string>[] = [
      { host: 'localhost', __unenv__: '1' },
      { host: 'localhost', 'x-unenv': '1' },
      { host: 'localhost', 'x-internal': 'true' },
    ]
    for (const headers of attempts) {
      expect(devAuthBypassEnabled(forged(headers)), JSON.stringify(headers)).toBe(false)
    }
  })
})

// 🔴 GATE 4. The internal-fetch exception is only safe because no stranger can
// reach the listener at all. [sikkerhed] named this as an unasserted assumption
// on #292 — and Nitro's default bind is 0.0.0.0, so it was not even likely.
describe('the loopback-bind assertion', () => {
  it('refuses to start a bypassed server bound to every interface', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.171', undefined]) {
      expect(
        () => assertBypassBindsLoopback({ STUDIO_DEV_AUTH_BYPASS: '1', HOST: host }),
        String(host),
      ).toThrow(DEV_AUTH_BYPASS_NOT_LOOPBACK_BOUND)
    }
  })

  it('names the host it found, so the message is actionable', () => {
    expect(() =>
      assertBypassBindsLoopback({ STUDIO_DEV_AUTH_BYPASS: '1', HOST: '0.0.0.0' }),
    ).toThrow(/HOST=0\.0\.0\.0/)
    expect(() => assertBypassBindsLoopback({ STUDIO_DEV_AUTH_BYPASS: '1' })).toThrow(/HOST=unset/)
  })

  it('accepts the loopback spellings, and NITRO_HOST as the alternative name', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(() =>
        assertBypassBindsLoopback({ STUDIO_DEV_AUTH_BYPASS: '1', HOST: host }),
      ).not.toThrow()
    }
    expect(() =>
      assertBypassBindsLoopback({ STUDIO_DEV_AUTH_BYPASS: '1', NITRO_HOST: '127.0.0.1' }),
    ).not.toThrow()
  })

  // Without the bypass there is nothing to protect, and a server bound to
  // 0.0.0.0 is the normal production case.
  it('says nothing when the bypass is off', () => {
    expect(() => assertBypassBindsLoopback({ HOST: '0.0.0.0' })).not.toThrow()
  })
})

// 🔴 GATE 4: WHICH PAGE, NOT WHICH MACHINE. [sikkerhed] found the hole after
// #294 by asking who ELSE sits on loopback. A hostile page open in the
// reviewer's own browser is not a stranger to the listener: the browser sends
// from their machine, the peer address is loopback, the Host is loopback, and
// the bypass needs no cookie — so the endpoint ran as the bypass user. The
// response is unreadable cross-origin, but THE WRITE LANDS, and a form post
// needs no preflight. Worse than ordinary CSRF: the origin IS the session, so
// every tab in that browser was authenticated.
describe('the cross-origin gate', () => {
  const fromPage = (site: string | undefined) =>
    ({
      node: {
        req: {
          headers:
            site === undefined
              ? { host: 'localhost:3020' }
              : { host: 'localhost:3020', 'sec-fetch-site': site },
          socket: { remoteAddress: '127.0.0.1' },
        },
      },
      headers: new Headers({}),
    }) as unknown as H3Event

  it('refuses a request made by a page from another origin', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(fromPage('cross-site'))).toBe(false)
  })

  // 🔴 STRICTER THAN THE PROPOSED CURE, AND THE CELL SAYS WHY. Rejecting only
  // `cross-site` leaves `same-site`, which on localhost is not empty: origins
  // differing only by PORT are same-site. A hostile page on localhost:9999
  // would have walked through the one-line version.
  it('refuses same-site too, because a different PORT is same-site on localhost', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(fromPage('same-site'))).toBe(false)
  })

  it("allows the app's own requests and a user-typed navigation", () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(fromPage('same-origin')), 'same-origin').toBe(true)
    expect(devAuthBypassEnabled(fromPage('none')), 'none').toBe(true)
  })

  // A non-browser client omits the header entirely. Treating absence as a
  // refusal would break curl, the SSR fetch and every measurement in this file.
  it('allows a request with no Sec-Fetch-Site at all', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    expect(devAuthBypassEnabled(fromPage(undefined))).toBe(true)
    expect(isSameOriginRequest(fromPage(undefined))).toBe(true)
  })

  it('is case- and whitespace-insensitive, as header values are', () => {
    expect(isSameOriginRequest(fromPage(' Same-Origin '))).toBe(true)
    expect(isSameOriginRequest(fromPage('CROSS-SITE'))).toBe(false)
  })

  // 🔴 ORDER MATTERS AND IS PINNED: the cross-origin check runs BEFORE the
  // internal shortcut, so "internal" can never be read as a way past it.
  it('refuses a cross-site request even if it also looks internal', () => {
    process.env.NODE_ENV = 'development'
    process.env.STUDIO_DEV_AUTH_BYPASS = '1'
    const both = {
      node: {
        req: {
          headers: { host: 'localhost:3020', 'sec-fetch-site': 'cross-site' },
          socket: { remoteAddress: '' },
          __unenv__: {},
        },
      },
      headers: new Headers({}),
    } as unknown as H3Event
    expect(isInternalRequest(both)).toBe(true)
    expect(devAuthBypassEnabled(both)).toBe(false)
  })
})

// 🔴 THE BIND ASSERTION MOVED OUT OF MODULE SCOPE, AND THAT TRADE NEEDS A
// MECHANICAL READER (#294 follow-up).
//
// It used to run because this module was IMPORTED — impossible to remove
// without removing the import. It now runs from a Nitro plugin, because what
// it asserts is about a LISTENER and the module is also imported by things
// that open no port (measured: `pnpm db:seed` died with "refusing to start a
// bypassed server" while starting no server).
//
// The new arrangement FAILS OPEN: delete the plugin and the bypass runs on a
// 0.0.0.0-bound server with nothing complaining. So the plugin's existence is
// not left to discipline.
describe('the bind assertion is wired to something that starts a listener', () => {
  it('a Nitro plugin calls assertBypassBindsLoopback', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const dir = new URL('../plugins/', import.meta.url)
    const plugins = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

    expect(plugins.length, 'denominator: server plugins searched').toBeGreaterThan(0)

    // 🔴 BOTH CONDITIONS, AND THE SECOND ONE IS [sikkerhed]'s (#302 verdict).
    // This cell reads TEXT, not the EVENT: it establishes that a plugin file
    // contains the call, never that Nitro loaded it. Requiring the registration
    // form too keeps it text, but it is the text NITRO ITSELF KEYS ON — so a
    // file that merely mentions the call, or one whose export form changed so
    // Nitro no longer picks it up, stops counting.
    //
    // 🔴 COMMENTS ARE STRIPPED FIRST, and that is [sikkerhed]'s correction of
    // their own #302 verdict: they wrote that the pattern "requires a CALL, not
    // a mention in a comment", then measured it and found it false. A regex
    // does not know what a comment is. A file holding
    // `// remember to call assertBypassBindsLoopback() one day` beside an empty
    // `export default defineNitroPlugin(() => {})` passed BOTH patterns.
    //
    // The edit that scenario describes — remove the call, leave a note saying
    // it is temporarily off — is not the likeliest one, but it is exactly the
    // kind that survives because nobody measures again.
    //
    // Calibrated rather than oversold. Caught: the file is deleted (likeliest
    // regression); the directory moves (the denominator above); the
    // registration form changes; the call survives only as a comment. NOT
    // caught: the call placed behind a condition that never runs — this reads
    // TEXT, never the EVENT. The event is measured on the artifact instead:
    // bypass on with HOST=0.0.0.0 throws and never serves.
    // A naive strip: it would also cut the tail of a `https://…` inside a
    // string. Harmless for what this asks — it can only ever REMOVE text, and
    // both things it looks for sit on lines of their own — and the real plugin
    // passing is the control that says so.
    const withoutComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const callers = plugins.filter((f) => {
      const src = withoutComments(readFileSync(new URL(f, dir), 'utf8'))
      return (
        /assertBypassBindsLoopback\s*\(/.test(src) && /export default defineNitroPlugin\(/.test(src)
      )
    })
    expect(
      callers,
      `no server plugin both calls assertBypassBindsLoopback AND registers via ` +
        `\`export default defineNitroPlugin(\` — the bypass could bind 0.0.0.0 with nothing ` +
        `asserting otherwise. Searched: ${plugins.join(', ')}`,
    ).not.toHaveLength(0)
  })

  it('the module itself does not call it at import time', async () => {
    // The other half of the same trade. If both were true the seed would trip
    // again, and the plugin would look like it was doing the work.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./dev-auth-bypass.ts', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export function assertBypassBindsLoopback'))
    const afterFunction = body.slice(body.indexOf('\n}') + 2)

    expect(
      /^\s*assertBypassBindsLoopback\s*\(\s*\)/m.test(afterFunction),
      'dev-auth-bypass.ts calls assertBypassBindsLoopback at module scope again — ' +
        'importing it (e.g. from server/db/seed.ts) will fail on a process that binds nothing',
    ).toBe(false)
  })

  it('still refuses a non-loopback bind when it IS asked', () => {
    // The rule itself is unchanged; only its trigger moved. Without this the
    // two cells above would pass on a function that asserts nothing.
    expect(() =>
      assertBypassBindsLoopback({ STUDIO_DEV_AUTH_BYPASS: '1', HOST: '0.0.0.0' }),
    ).toThrow(/refusing to start/)
    expect(() =>
      assertBypassBindsLoopback({ STUDIO_DEV_AUTH_BYPASS: '1', HOST: '127.0.0.1' }),
    ).not.toThrow()
  })
})
