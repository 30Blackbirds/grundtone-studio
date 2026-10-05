import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The helper writes to one table and optionally reads the H3 session. We stub
// both, capturing every insert so the test can assert the row shape.

const inserts: Array<Record<string, unknown>> = []
let insertThrows: unknown = null

vi.mock('../db', () => {
  const insert = () => ({
    values: (row: Record<string, unknown>) => {
      inserts.push(row)
      return insertThrows ? Promise.reject(insertThrows) : Promise.resolve()
    },
  })
  return { db: { insert } }
})

// The failure counter, captured rather than emitted. Without this the cells
// below could only assert that nothing throws — which is also what a version
// that silently drops the event does.
const failures: string[] = []
vi.mock('./metrics', () => ({
  recordAuditWriteFailed: (action: string) => {
    failures.push(action)
  },
}))
vi.mock('../db/schema', () => ({ auditLog: {} }))

// h3 is a transitive dep via Nuxt — vitest's resolver can't find it directly.
// Stub the helpers we use so the test runs standalone.
vi.mock('h3', () => ({
  getRequestIP: (event: { node?: { req?: { headers?: Record<string, string> } } }) =>
    event?.node?.req?.headers?.['x-forwarded-for'] ?? null,
  getRequestHeader: (
    event: { node?: { req?: { headers?: Record<string, string> } } },
    name: string,
  ) => event?.node?.req?.headers?.[name.toLowerCase()] ?? null,
}))

const { recordAuditEvent, AUDIT_ACTIONS } = await import('./audit')

const ORG_ID = 'org-1'
const ACTOR = { sub: 'user-1', tenant: ORG_ID, email: 'allan@example.com' }

describe('recordAuditEvent', () => {
  beforeEach(() => {
    inserts.length = 0
  })

  it('persists a minimal event with no event handle', async () => {
    await recordAuditEvent(null, {
      organizationId: ORG_ID,
      action: 'project.created',
      targetType: 'project',
      targetId: 'p1',
      targetLabel: 'Greenbow',
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      organizationId: ORG_ID,
      action: 'project.created',
      targetType: 'project',
      targetId: 'p1',
      targetLabel: 'Greenbow',
      actorUserId: null,
      actorEmail: null,
      ipAddress: null,
      userAgent: null,
    })
  })

  it('captures actor + IP + UA from event.context.auth when present', async () => {
    // Identity comes from the JWT-derived actor on event.context.auth.
    // getRequestIP/getRequestHeader read from event.node.req.
    const fakeEvent = {
      headers: new Headers(),
      context: { auth: ACTOR },
      node: {
        req: {
          headers: {
            'x-forwarded-for': '203.0.113.7',
            'user-agent': 'curl/7.88',
          },
          socket: { remoteAddress: '127.0.0.1' },
        },
      },
    } as unknown as Parameters<typeof recordAuditEvent>[0]
    await recordAuditEvent(fakeEvent, {
      organizationId: ORG_ID,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: 'k1',
    })
    expect(inserts[0]).toMatchObject({
      organizationId: ORG_ID,
      action: 'api_key.created',
      actorUserId: ACTOR.sub,
      actorEmail: ACTOR.email,
      ipAddress: '203.0.113.7',
      userAgent: 'curl/7.88',
    })
  })

  it('explicit actor fields win over context-derived ones', async () => {
    const fakeEvent = {
      headers: new Headers(),
      context: { auth: ACTOR },
      node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
    } as unknown as Parameters<typeof recordAuditEvent>[0]
    await recordAuditEvent(fakeEvent, {
      organizationId: ORG_ID,
      action: 'member.invited',
      actorUserId: 'system-1',
      actorEmail: 'system@grundtone.com',
    })
    expect(inserts[0]).toMatchObject({
      actorUserId: 'system-1',
      actorEmail: 'system@grundtone.com',
    })
  })

  it('swallows insert failures so audit cannot break the underlying mutation', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Force the insert to throw by mutating the inserts array's push.
    const originalPush = inserts.push.bind(inserts)
    inserts.push = () => {
      throw new Error('boom')
    }
    await expect(
      recordAuditEvent(null, { organizationId: ORG_ID, action: 'project.created' }),
    ).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    inserts.push = originalPush
    errSpy.mockRestore()
  })

  it('ignores event.context.auth when actor fields are already supplied', async () => {
    const fakeEvent = {
      headers: new Headers(),
      context: { auth: ACTOR },
      node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
    } as unknown as Parameters<typeof recordAuditEvent>[0]
    await recordAuditEvent(fakeEvent, {
      organizationId: ORG_ID,
      action: 'member.role_changed',
      actorUserId: 'pre-known',
      actorEmail: 'pre-known@example.com',
    })
    expect(inserts[0]).toMatchObject({
      actorUserId: 'pre-known',
      actorEmail: 'pre-known@example.com',
    })
  })
})

describe('AUDIT_ACTIONS labels', () => {
  // The audit page and the dashboard render t(`audit.actions.<action>`). An
  // action without a label would show its raw key, so every entry needs both.
  const locale = (code: string) =>
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../i18n/locales/${code}.json`, import.meta.url)),
        'utf8',
      ),
    ) as { audit: { actions: Record<string, string> } }

  it.each(['en', 'da'])('has an audit.actions label in %s for every action', (code) => {
    const labels = locale(code).audit.actions
    const missing = AUDIT_ACTIONS.filter((a) => !labels[a])
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })
})

describe('🔴 AC-G: a failed audit write is swallowed — and now COUNTED', () => {
  // recordAuditEvent catches every error by design: a failed insert must not
  // break the publish that caused it. But a failure that only reaches
  // console.error is a gap in the log nobody learns about, and "is the audit
  // log complete?" then has no answer at any of its 18 call sites.
  beforeEach(() => {
    inserts.length = 0
    failures.length = 0
    insertThrows = null
  })

  it('does NOT throw when the insert fails — the request must survive', async () => {
    // The positive control for the deliberate swallow. If this ever starts
    // throwing, 18 call sites change behaviour at once.
    insertThrows = new Error('deadlock detected')
    await expect(
      recordAuditEvent(null, { organizationId: ORG_ID, action: 'config.published' }),
    ).resolves.toBeUndefined()
  })

  it('counts the failure, with the action that was lost', async () => {
    // 🔴 THIS IS THE WHOLE POINT. "Nothing threw" is also what a version that
    // silently drops events looks like. The counter is the only thing that
    // distinguishes a written event from a lost one.
    insertThrows = new Error('deadlock detected')
    await recordAuditEvent(null, { organizationId: ORG_ID, action: 'config.published' })
    expect(failures).toEqual(['config.published'])
  })

  it('does NOT count a successful write (negative control)', async () => {
    await recordAuditEvent(null, { organizationId: ORG_ID, action: 'config.published' })
    expect(inserts).toHaveLength(1)
    expect(failures).toEqual([])
  })
})

describe('🔴 AC-G: a MACHINE actor is named in the row', () => {
  // "Who did this?" must be answerable for a provisioning key, not just for a
  // person. A machine principal is { sub: 'machine:{keyId}', tenant } with NO
  // email — so the row carries the key id and a null email, and that is the
  // shape an investigation gets. If `sub` were ever dropped for machines, the
  // row would say an action happened and name nobody.
  beforeEach(() => {
    inserts.length = 0
    failures.length = 0
    insertThrows = null
  })

  it('records machine:{keyId} as the actor, with a null email', async () => {
    const event = { context: { auth: { sub: 'machine:key-1', tenant: ORG_ID } } }
    await recordAuditEvent(event as never, {
      organizationId: ORG_ID,
      action: 'config.draft_saved',
    })
    expect(inserts[0]).toMatchObject({
      actorUserId: 'machine:key-1',
      actorEmail: null,
      action: 'config.draft_saved',
    })
  })

  it('still prefers an explicitly passed actor over the context', async () => {
    // The override exists for flows with no request actor; it must not be
    // shadowed by the machine principal.
    const event = { context: { auth: { sub: 'machine:key-1', tenant: ORG_ID } } }
    await recordAuditEvent(event as never, {
      organizationId: ORG_ID,
      action: 'config.draft_saved',
      actorUserId: 'user-9',
      actorEmail: 'a@b.c',
    })
    expect(inserts[0]).toMatchObject({ actorUserId: 'user-9', actorEmail: 'a@b.c' })
  })
})

describe('🔴 AC-G completeness: the call sites, and what proves they FIRE', () => {
  // Two different claims, and conflating them is how an audit gap hides.
  //
  // 🔴 THIS FIRST CELL IS A SOURCE CHECK AND CANNOT SEE EXECUTION. A mutation
  // proved it: wrapping publish.post's audit call in `if (false)` left the whole
  // suite GREEN, because the string `recordAuditEvent(` was still in the file.
  // A commented-out call, a dead branch, or a call behind an impossible
  // condition all pass here. That is why the second cell exists.
  //
  // 🔴 AUDIT IS REACHED TWO WAYS AND I MEASURED THE WRONG ONE FIRST. My first
  // sweep counted `recordAuditEvent` inside each endpoint and reported
  // config.post and tokens/import.post as gaps. Both delegate to
  // `lib/save-draft.ts`, which audits. Grepping the CONSUMERS instead of
  // enumerating the MECHANISM's call sites produced the false gap.
  const API = join(import.meta.dirname, '..', 'api')

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) return walk(p)
      return /\.(post|put|patch|delete)\.ts$/.test(e) && !e.endsWith('.test.ts') ? [p] : []
    })
  }

  function reachable(): string[] {
    return walk(API).filter((p) => {
      const rel = p.replace(API, '')
      if (rel.startsWith('/orgs/')) return true
      return /requireProjectAccess\(event, projectId, '(editor|admin)'\)/.test(
        readFileSync(p, 'utf8'),
      )
    })
  }

  it('finds the reachable mutations at all (denominator)', () => {
    // Measured 15 on 2026-10-03 and again on 2026-10-05.
    expect(reachable().length).toBeGreaterThanOrEqual(15)
  })

  it('each one REFERENCES an audit write, directly or through saveDraft', () => {
    const gaps = reachable().filter((p) => {
      const src = readFileSync(p, 'utf8')
      return !src.includes('recordAuditEvent(') && !src.includes('saveDraft(')
    })
    expect(gaps.map((p) => p.replace(API, ''))).toEqual([])
  })

  it('🔴 names exactly which ones have NOTHING proving the write fires', () => {
    // The honest half. 9 of 15 have a cell that asserts on a captured audit
    // event; 6 have no test file at all, so removing their audit call ships
    // green — which is what mutation 3 demonstrated on publish.post.
    //
    // A TRIPWIRE IN BOTH DIRECTIONS. Add a test file for one of these six and
    // this turns red: delete it from the list, that is the point. Delete an
    // assertion from one of the other nine and it turns red too, with the
    // regression named. The list is the finding, kept where it cannot rot.
    //
    // My first count said ELEVEN, and that was my own instrument: the pattern
    // looked for `audits` and these files use `auditEvents`. Corrected before
    // it reached a tracker.
    // Shrinking as the files land (869fbuf68). config.post and
    // api-keys/[keyId].delete now have their own cells; config.post's AUDIT is
    // proven in save-draft.test.ts, which had no file either and is where the
    // event for BOTH delegating doors actually lives.
    const UNPROVEN = [
      '/projects/[projectId]/activate.post.ts',
      '/projects/[projectId]/api-keys.post.ts',
      '/projects/[projectId]/tokens/import.post.ts',
    ]
    // 🔴 A DELEGATING ENDPOINT IS PROVEN ONE LEVEL DOWN, and asking the wrong
    // question here produced a false entry. config.post.ts has its own cells
    // but deliberately no audit assertion: it hands off to lib/save-draft.ts,
    // and `config.draft_saved` is asserted in save-draft.test.ts. Counting only
    // the endpoint's own file called that unproven when it is not. Delete
    // save-draft.test.ts and both delegating doors return to this list, which is
    // the behaviour that makes the shortcut safe.
    const DELEGATE_PROVEN = /expect\(\s*audit\w*/i.test(
      existsSync(join(import.meta.dirname, 'save-draft.test.ts'))
        ? readFileSync(join(import.meta.dirname, 'save-draft.test.ts'), 'utf8')
        : '',
    )
    const unproven = reachable()
      .filter((p) => {
        const src = readFileSync(p, 'utf8')
        const t = p.replace(/\.ts$/, '.test.ts')
        const own = existsSync(t) && /expect\(\s*audit\w*/i.test(readFileSync(t, 'utf8'))
        if (own) return false
        // Delegates to saveDraft AND has cells of its own proving it delegates.
        if (src.includes('saveDraft(') && existsSync(t) && DELEGATE_PROVEN) return false
        return true
      })
      .map((p) => p.replace(API, ''))
      .sort()
    expect(unproven).toEqual(UNPROVEN)
  })
})
