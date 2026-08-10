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

vi.mock('@connectrpc/connect', () => ({
  createPromiseClient: () => ({
    grantRole: vi.fn(async () => ({})),
    revokeRole: vi.fn(async () => ({})),
    writeTuple: vi.fn(async () => ({})),
    check: vi.fn(async (req: { subject: string }) => {
      lastCheckSubject = req.subject
      return { allow: true }
    }),
  }),
}))

vi.mock('@klanghaus/permissions-client/connect', () => ({ PermissionsService: {} }))

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
    await expect(checkProject(fakeEvent(), 'p1', 'can_view')).resolves.toBe(true)
  })
})
