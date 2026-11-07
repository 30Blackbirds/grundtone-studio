import { describe, it, expect, vi, beforeEach } from 'vitest'

// SIK-003: skrive-stier skal baere en TJENESTE-identitet, laese-stier skal
// blive paa brugerens token.
//
// Begge halvdele testes, og det er med vilje. Den farligste fejl her er ikke
// at glemme tjeneste-tokenet — den er at skifte for MEGET: laesningerne
// afgoer, hvad DENNE bruger maa, og med tjeneste-identiteten ville svaret
// vaere ja for alt. En test der kun daekker skrive-stierne ville vaere groen
// gennem praecis det brud.

const created: Array<{ token: string | null }> = []
let lastCheckSubject: string | null = null
// Per-test PDP behaviour: return a response, or throw to simulate a failure.
let checkImpl: () => Promise<{ allow: boolean }> = async () => ({ allow: true })
let batchImpl: () => Promise<{ results: Array<{ allow: boolean }> }> = async () => ({
  results: [{ allow: true }],
})
const unavailableReasons: string[] = []

vi.mock('@connectrpc/connect-node', () => ({
  createConnectTransport: (opts: { interceptors: Array<(n: unknown) => unknown> }) => {
    // Interceptoren saetter Authorization; vi fanger vaerdien ved at koere den
    // mod et minimalt fake-request.
    let token: string | null = null
    const interceptor = opts.interceptors[0] as unknown as (
      next: (r: unknown) => unknown,
    ) => (r: { header: { set: (k: string, v: string) => void } }) => unknown
    interceptor((r) => r)({
      header: {
        set: (_k, v) => {
          token = v
        },
      },
    })
    created.push({ token })
    return {}
  },
}))

// The REAL ConnectError and Code are kept: classification must be tested
// against the error type the transport actually throws, not a look-alike.
vi.mock('@connectrpc/connect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@connectrpc/connect')>()),
  createPromiseClient: () => ({
    grantRole: vi.fn(async () => ({})),
    revokeRole: vi.fn(async () => ({})),
    writeTuple: vi.fn(async () => ({})),
    check: vi.fn(async (req: { subject: string }) => {
      lastCheckSubject = req.subject
      return checkImpl()
    }),
    batchCheck: vi.fn(async () => batchImpl()),
  }),
}))

vi.mock('./metrics', () => ({
  recordPdpUnavailable: (reason: string) => unavailableReasons.push(reason),
}))

vi.mock('../vendor/permissions-client/src/connect', () => ({ PermissionsService: {} }))

vi.mock('h3', () => ({
  createError: (o: { statusCode: number; statusMessage?: string }) =>
    Object.assign(new Error(o.statusMessage ?? ''), {
      statusCode: o.statusCode,
      statusMessage: o.statusMessage,
    }),
}))

const fakeEvent = () =>
  ({
    context: { auth: { sub: 'user-1', tenant: 'org-1' }, authToken: 'USER_TOKEN' },
    node: { req: { headers: {} } },
  }) as never

describe('PDP-klienten skelner mellem skrive- og laese-stier', () => {
  beforeEach(() => {
    vi.resetModules()
    created.length = 0
    lastCheckSubject = null
    process.env.PERMISSIONS_URL = 'http://pdp.test'
    process.env.PDP_S2S_TOKEN = 'SERVICE_TOKEN'
  })

  it('SKRIVER med tjeneste-tokenet', async () => {
    const { grantProjectRole } = await import('./pdp')
    await grantProjectRole(fakeEvent(), 'p1', 'user-2', 'editor')
    expect(created.at(-1)?.token).toBe('Bearer SERVICE_TOKEN')
  })

  // 🔴 Den vigtige halvdel: skiftes denne med, spoerger vi PDP'en, hvad
  // service:studio maa — ikke hvad brugeren maa.
  it('LAESER med brugerens token, og subject er brugeren', async () => {
    const { checkProject } = await import('./pdp')
    await checkProject(fakeEvent(), 'p1', 'can_view')
    expect(created.at(-1)?.token).toBe('Bearer USER_TOKEN')
    expect(lastCheckSubject).toBe('user-1')
  })

  // Fail-closed, bevidst: en fallback til brugerens token ville stille
  // genindfoere den tilstand, fase 2 fjerner — og se ud som om alt virker.
  it('AFVISER en skrivning naar tjeneste-tokenet mangler — falder ikke tilbage', async () => {
    delete process.env.PDP_S2S_TOKEN
    const { grantProjectRole } = await import('./pdp')
    const err = (await grantProjectRole(fakeEvent(), 'p1', 'user-2', 'editor').catch(
      (e: unknown) => e,
    )) as { statusCode: number; statusMessage: string }
    expect(err.statusCode).toBe(503)
    expect(err.statusMessage).toContain('PDP_S2S_TOKEN')
    expect(created.at(-1)?.token).not.toBe('Bearer USER_TOKEN')
  })

  it('laesninger virker fortsat uden tjeneste-tokenet', async () => {
    delete process.env.PDP_S2S_TOKEN
    const { checkProject } = await import('./pdp')
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe('allowed')
  })
})

// Top-level await: the real error type and codes the classifier is tested against.
const { ConnectError, Code } =
  await vi.importActual<typeof import('@connectrpc/connect')>('@connectrpc/connect')

describe('read helpers distinguish an outage from a denial (riff iub38z651y7nr21bovn0683w)', () => {
  beforeEach(() => {
    vi.resetModules()
    created.length = 0
    unavailableReasons.length = 0
    process.env.PERMISSIONS_URL = 'http://pdp.test'
    process.env.PDP_S2S_TOKEN = 'SERVICE_TOKEN'
    checkImpl = async () => ({ allow: true })
    batchImpl = async () => ({ results: [{ allow: true }] })
  })

  it('PDP answers yes → allowed; PDP answers no → denied (control)', async () => {
    const { checkProject } = await import('./pdp')
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe('allowed')
    checkImpl = async () => ({ allow: false })
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe('denied')
    expect(unavailableReasons).toEqual([])
  })

  it('PDP unreachable (Code.Unavailable) → unavailable, counted — NOT denied', async () => {
    checkImpl = async () => {
      throw new ConnectError('connect ECONNREFUSED', Code.Unavailable)
    }
    const { checkProject } = await import('./pdp')
    await expect(checkProject(fakeEvent(), 'p1', 'can_edit')).resolves.toBe('unavailable')
    expect(unavailableReasons).toEqual(['Unavailable'])
  })

  it('timeout and internal errors are unavailable too', async () => {
    const { checkOrg } = await import('./pdp')
    checkImpl = async () => {
      throw new ConnectError('deadline', Code.DeadlineExceeded)
    }
    await expect(checkOrg(fakeEvent(), 'o1', 'member')).resolves.toBe('unavailable')
    checkImpl = async () => {
      throw new ConnectError('boom', Code.Internal)
    }
    await expect(checkOrg(fakeEvent(), 'o1', 'member')).resolves.toBe('unavailable')
    expect(unavailableReasons).toEqual(['DeadlineExceeded', 'Internal'])
  })

  it('a non-Connect transport error is unavailable', async () => {
    checkImpl = async () => {
      throw new TypeError('fetch failed')
    }
    const { checkProject } = await import('./pdp')
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe('unavailable')
    expect(unavailableReasons).toEqual(['transport'])
  })

  it('an identity rejection is a denial, not an outage', async () => {
    const { checkProject } = await import('./pdp')
    checkImpl = async () => {
      throw new ConnectError('bad token', Code.Unauthenticated)
    }
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe('denied')
    checkImpl = async () => {
      throw new ConnectError('not yours', Code.PermissionDenied)
    }
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe('denied')
    expect(unavailableReasons).toEqual([])
  })

  it('missing PERMISSIONS_URL is misconfiguration → unavailable', async () => {
    delete process.env.PERMISSIONS_URL
    const { checkProject } = await import('./pdp')
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe('unavailable')
  })

  it('no actor → denied without asking the PDP', async () => {
    const { checkProject } = await import('./pdp')
    const noActor = { context: {}, node: { req: { headers: {} } } } as never
    await expect(checkProject(noActor, 'p1', 'can_view')).resolves.toBe('denied')
    expect(unavailableReasons).toEqual([])
  })

  it('a failed batch marks every project unavailable, never allowed', async () => {
    batchImpl = async () => {
      throw new ConnectError('down', Code.Unavailable)
    }
    const { batchCheckProjects } = await import('./pdp')
    await expect(batchCheckProjects(fakeEvent(), ['p1', 'p2'], 'can_view')).resolves.toEqual({
      p1: 'unavailable',
      p2: 'unavailable',
    })
  })

  it('classifyPdpFailure treats HTTP 401/403 from the token exchange as denied', async () => {
    const { classifyPdpFailure } = await import('./pdp')
    expect(classifyPdpFailure({ statusCode: 401 })).toBe('denied')
    expect(classifyPdpFailure({ status: 403 })).toBe('denied')
    expect(classifyPdpFailure({ statusCode: 502 })).toBe('unavailable')
  })
})
