import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// Portal-sessionen var hidtil kun dækket i ANDEN HÅND — gennem checkout-testen,
// fordi de to delte den samme afskrevne preamble. Da preamblen blev trukket ud
// i org-request.ts, forsvandt selv den indirekte dækning: to endepunkter der
// kalder samme helper beviser ikke, at DETTE endepunkt kalder den rigtigt.
// §7a-kontrakten (kortskifte uden at kortdata krydser Studio) fortjener sin
// egen eksekverbare rækkefølge.

let nextOrg: {
  id: string
  members?: { userId: string; role: string }[]
} | null = null
const originalAccountUrl = process.env.ACCOUNT_URL

vi.mock('h3', () => mockH3())
vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgBySlug: () => Promise.resolve(nextOrg),
}))
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('~~/server/lib/pdp', () => ({ checkOrg: vi.fn(), checkProject: vi.fn() }))
const mintAccountUserToken = vi.fn((_e: unknown, _org: string) => Promise.resolve('user-jwt'))
vi.mock('~~/server/lib/account-user-token', () => ({ mintAccountUserToken }))

const handler = (await import('./portal-session.post')).default as unknown as (
  event: FakeEvent,
) => Promise<unknown>

const VALID_BODY = { organizationSlug: 'acme' }

function authedEvent(body: Record<string, unknown>): FakeEvent {
  return fakeEvent({
    body,
    context: { auth: { sub: 'user-1', tenant: 'org-1', email: 'user-1@acme.test' } },
  })
}

beforeEach(() => {
  nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'owner' }] }
  delete process.env.ACCOUNT_URL
})

// Samme oprydning som i checkout-session.test.ts: env-variablen maa ikke
// laekke til de foelgende tests. En test der bestaar, fordi en variabel blev
// sat i en TIDLIGERE test, er ikke til at skelne fra en der bestaar af egen
// kraft — og raekkefoelgen kan aendre sig uden at nogen roerer testen.
afterEach(() => {
  delete process.env.STUDIO_INTERNAL_ORG_IDS
})

afterAll(() => {
  if (originalAccountUrl === undefined) delete process.env.ACCOUNT_URL
  else process.env.ACCOUNT_URL = originalAccountUrl
})

describe('POST /api/billing/portal-session (§7a kortskifte)', () => {
  it('401s without auth', async () => {
    await expect(handler(fakeEvent({ body: VALID_BODY, context: {} }))).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('400s on an empty organizationSlug', async () => {
    await expect(handler(authedEvent({ organizationSlug: '' }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('404s when the scoped lookup resolves to no org', async () => {
    nextOrg = null
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 404 })
  })

  // Portalen kan — afhængigt af accounts portal-konfiguration — også skifte
  // plan, så den er en billing-handling og ikke bare en profil-side.
  it('403s for roles without billing rights', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Requires the owner or billing role',
    })
  })

  // 🔴 BETA-VAERNET PAA DENNE RUTE var UMAALT indtil nu. Maalt: neutraliseres
  // `assertBetaPurchasesClosed`, bestod hele filen alligevel 5/5 — kun den
  // DELTE funktion var daekket (`beta-purchases.test.ts`), ikke rutens VALG om
  // at kalde den. Det er samme klasse som "ekstraktion goer vaernet til et
  // argument": helperen er testet, kaldestedet er det ikke.
  //
  // Portal-doeren er ikke mindre vigtig end checkout: Stripe-portalen kan
  // skifte plan afhaengigt af konfiguration, saa et aabent portal-endpoint
  // ville vaere en opgraderingsvej udenom beta-lukningen.
  it('403er et almindeligt org med juras fejlkode (beta-vaernet paa portal-ruten)', async () => {
    delete process.env.STUDIO_INTERNAL_ORG_IDS
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'beta_paid_plans_closed' },
    })
  })

  // 🔴 POSITIV KONTROL. Uden den beviser testene ovenfor kun, at ALT afvises —
  // og en gate der afviser alt er ikke til at skelne fra en i stykker. Et
  // gyldigt kald skal nå LÆNGERE ned i handleren: til den dormante 503.
  it('503s dormant when ACCOUNT_URL is unset — with a valid body and the billing role', async () => {
    // Beta-vaernet (Beslutning AL) staar mellem rolle-tjekket og den dormante
    // 503, saa et almindeligt org naar den ikke laengere. Kontrollen maales
    // derfor gennem et INTERNT org, der passerer vaernet.
    //
    // 🔴 Den nemme "rettelse" ville vaere at forvente 403 her. Det ville
    // OEDELAEGGE kontrollen: den ville saa assertere praecis det samme som de
    // negative tests ovenfor, og filen ville kun bevise at ALT afvises — som
    // er nøjagtig det, kommentaren ovenfor siger at kontrollen findes for at
    // udelukke. Et gyldigt kald skal naa LAENGERE ned, ikke lige saa kort.
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-1'

    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'billing_unavailable' },
    })
  })
})

// Condition 2 (a): a portal session can change the card and cancel, so account
// binds it to the logged-in billing user; Studio forwards that user's token.
describe("the logged-in user's token (account#186)", () => {
  beforeEach(() => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-1'
    process.env.ACCOUNT_URL = 'http://account.test'
    mintAccountUserToken.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: 'https://studio.test' } }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it("mints it for the request's org and forwards it to account", async () => {
    mintAccountUserToken.mockResolvedValue('user-jwt')
    const fetchMock = vi.fn((_u: string, _i: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ portalUrl: 'https://stripe.test/p' }))),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(handler(authedEvent(VALID_BODY))).resolves.toEqual({
      portalUrl: 'https://stripe.test/p',
    })
    expect(mintAccountUserToken.mock.calls[0]![1]).toBe('org-1')
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>
    expect(headers['x-klanghaus-user-token']).toBe('user-jwt')
  })

  it('🔴 never calls account when the token cannot be minted', async () => {
    mintAccountUserToken.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 401 }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
