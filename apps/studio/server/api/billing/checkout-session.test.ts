import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'
import { CHECKOUT_PLAN_KEYS, getPlan } from '~~/lib/plan-catalog'

// §1a-ruling (jura): no Stripe session without active terms accept + business
// attestation — the 400 is a legal requirement, not incidental validation.

let nextOrg: {
  id: string
  members: { userId: string; role: string }[]
} | null = null

vi.mock('h3', () => mockH3())

vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgBySlug: () => Promise.resolve(nextOrg),
}))
// The handler pulls orgRoleHelpers from project-access, whose module graph
// drags in the live db/pdp clients — stub the transitive deps, keep the real
// role logic in play via the actual import below.
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('~~/server/lib/pdp', () => ({ checkOrg: vi.fn(), checkProject: vi.fn() }))
vi.mock('~~/server/lib/brand-count', () => ({ currentBrandCount: () => Promise.resolve(12) }))

const handler = (await import('./checkout-session.post')).default as unknown as (
  event: FakeEvent,
) => Promise<unknown>

const VALID_BODY = {
  organizationSlug: 'acme',
  planKey: 'studio_solo',
  businessAttestation: {
    version: 'studio-b2b-erklaering-2026-08-02',
    acceptedAt: '2026-08-02T12:00:00Z',
  },
  termsAccepted: { version: 'studio-vilkaar-2026-08-02-draft', acceptedAt: '2026-08-02T12:00:00Z' },
  vatNumber: 'DK12345678',
}

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

afterEach(() => {
  delete process.env.STUDIO_INTERNAL_ORG_IDS
})

describe('POST /api/billing/checkout-session (§1a accept-gate)', () => {
  it('401s without auth', async () => {
    await expect(handler(fakeEvent({ body: VALID_BODY, context: {} }))).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('400s without termsAccepted (jura: ingen session uden accept-bevis)', async () => {
    const { termsAccepted: _omitted, ...body } = VALID_BODY
    await expect(handler(authedEvent(body))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('400s without a full businessAttestation proof (jura §0: eget bevisspor)', async () => {
    await expect(
      handler(authedEvent({ ...VALID_BODY, businessAttestation: true })),
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      handler(authedEvent({ ...VALID_BODY, businessAttestation: { version: 'x' } })),
    ).rejects.toMatchObject({ statusCode: 400 })
    const { businessAttestation: _omitted, ...body } = VALID_BODY
    await expect(handler(authedEvent(body))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('400s without vatNumber (§8c: obligatorisk)', async () => {
    const { vatNumber: _omitted, ...body } = VALID_BODY
    await expect(handler(authedEvent(body))).rejects.toMatchObject({ statusCode: 400 })
  })

  // 🔴 Assertionen binder til statusMessage, ikke bare til 403. Rolle-tjekket
  // OG beta-vaernet svarer begge 403, saa `toMatchObject({ statusCode: 403 })`
  // alene kan ikke se forskel paa dem — den bestaar uanset hvilket af dem der
  // fyrede. [review] maalte det: de byttede raekkefoelgen og fik 12/12 groenne.
  it('403s for roles without billing rights — med rollens EGEN besked', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
    // `statusMessage` er ikke en egen enumerable property paa h3's error, saa
    // toMatchObject kan ikke se den — beskeden naas via Error.message, og
    // `data` er den anden observerbare forskel.
    await expect(handler(authedEvent(VALID_BODY))).rejects.toThrowError(
      'Requires the owner or billing role',
    )
    // Laaser ogsaa mockens egen form: fjernes `err.statusMessage` fra
    // createError-mocken ovenfor, bliver DENNE linje roed. Uden den var
    // mock-rettelsen sand men ikke holdt fast — og en senere kopi-indsaettelse
    // af den gamle mock ville gaa ubemaerket igennem.
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Requires the owner or billing role',
    })
  })

  // 🔴 Gør purchasable-tjekkets LATENS eksekverbar. Tjekket i handleren er i
  // dag en død gren, fordi enummet kun admitterer købbare planer — og en død
  // gren siger intet om, hvor den skal stå. Kommer en ikke-købbar nøgle ind i
  // enummet, bliver DENNE rød, og så skal placeringen (400 fra tjekket vs 404
  // fra org-opslaget) besluttes bevidst frem for at skifte tavst.
  it.each([...CHECKOUT_PLAN_KEYS])(
    'lader planen %s passere purchasable-tjekket',
    async (planKey) => {
      process.env.STUDIO_INTERNAL_ORG_IDS = 'org-1'
      await expect(handler(authedEvent({ ...VALID_BODY, planKey }))).rejects.toMatchObject({
        statusCode: 503,
      })
    },
  )

  // Og den DIREKTE form af samme påstand: hver nøgle skemaet accepterer er
  // købbar. Læser CHECKOUT_PLAN_KEYS — altså den liste ruten selv bruger —
  // så en ny nøgle i skemaet ikke kan snige sig forbi en kopi i testen.
  it.each([...CHECKOUT_PLAN_KEYS])('plan %s er købbar i kataloget', (planKey) => {
    expect(getPlan(planKey).purchasable).toBe(true)
  })
  // 🔴 RAEKKEFOELGEN rolle-tjek FOER beta-vaernet, pinnet gennem den ENESTE
  // observerbare forskel: fejlkoden. Uden denne test er raekkefoelgen frit
  // omflyttelig, fordi begge svarer 403.
  //
  // Hvorfor raekkefoelgen betyder noget: fyrede beta-vaernet foerst, ville en
  // kaldere UDEN billing-rettigheder faa at vide at betalte planer aabner
  // 1. januar 2027 — altsaa laere noget om vores billing-tilstand, som
  // vedkommende ikke er autoriseret til at spoerge om. Autorisation foerst.
  it('lader rolle-tjekket fyre FOER beta-vaernet, ikke omvendt', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
    await expect(handler(authedEvent(VALID_BODY))).rejects.toThrowError(
      'Requires the owner or billing role',
    )
    // Og eksplicit: beta-koden maa IKKE vaere den der naaede frem foerst.
    // Begge svarer 403, saa fejlkoden er den eneste observerbare forskel.
    await expect(handler(authedEvent(VALID_BODY))).rejects.not.toMatchObject({
      data: { code: 'beta_paid_plans_closed' },
    })
  })

  // Beta-vaernet staar foran den dormante 503, saa et almindeligt org naar den
  // ikke laengere. Testens intention — at et usat ACCOUNT_URL rapporteres som
  // dormant og ikke som noget andet — er uaendret gyldig og maales nu gennem et
  // internt org, der passerer vaernet. Testen er tilpasset, ikke slettet:
  // 503-kontrakten er stadig en kontrakt, den er bare flyttet bagom vaernet.
  it('503s dormant when ACCOUNT_URL is unset — with a fully valid body', async () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-1'

    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'billing_unavailable' },
    })
  })
})

describe('beta-værnet (Beslutning AL / jura studio-beta-1.0 pkt. 2)', () => {
  // 🔴 Den NEGATIVE test: et direkte POST med en fuldt gyldig body afvises.
  // Det er hele pointen med server-side lukning — en skjult eller disabled
  // knap i UI'et er ingen håndhævelse, og denne test går uden om UI'et.
  it('403er et gyldigt købsforsøg med juras fejlkode', async () => {
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'beta_paid_plans_closed' },
    })
  })

  it('afviser hver betalt plan, ikke kun én', async () => {
    for (const planKey of ['studio_solo', 'studio_studio', 'studio_scale']) {
      await expect(handler(authedEvent({ ...VALID_BODY, planKey }))).rejects.toMatchObject({
        statusCode: 403,
        data: { code: 'beta_paid_plans_closed' },
      })
    }
  })

  // 🔴 POSITIV KONTROL. Uden den beviser testene ovenfor kun, at ALT afvises —
  // og en gate, der afviser alt, er ikke til at skelne fra en i stykker.
  // KlangHaus' egne orgs skal komme FORBI værnet (Allans tillæg), og det ses
  // ved, at kaldet nu fejler på den dormante 503 i stedet: et andet svar,
  // længere nede i handleren.
  it('lader KlangHaus egne orgs passere værnet (Allans tillæg)', async () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-internal'
    nextOrg = { id: 'org-internal', members: [{ userId: 'user-1', role: 'owner' }] }

    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 503 })
  })

  // Undtagelsen hviler på org-id'et fra auth, ikke på noget klienten sender.
  it('lader ikke et org slippe forbi ved at ligne et internt i bodyen', async () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-internal'
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'owner' }] }

    await expect(
      handler(authedEvent({ ...VALID_BODY, organizationSlug: 'org-internal' })),
    ).rejects.toMatchObject({ statusCode: 403, data: { code: 'beta_paid_plans_closed' } })
  })

  // 🔴 Usat liste = INGEN undtagelse. En glemt konfiguration skal lukke mere,
  // ikke mindre — den modsatte default ville gøre en tastefejl til en åben dør.
  it('giver ingen undtagelse når listen er usat', async () => {
    delete process.env.STUDIO_INTERNAL_ORG_IDS
    nextOrg = { id: 'org-internal', members: [{ userId: 'user-1', role: 'owner' }] }

    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 403 })
  })

  // Rækkefølgen bærer betydning: svaret på et gyldigt købsforsøg i beta er
  // "køb er lukket", ikke "billing er utilgængelig".
  it('står før den dormante 503', async () => {
    delete process.env.ACCOUNT_URL
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 403 })
  })
})

// Allan 2026-10-27: what Studio shows is what Stripe bills, from day one. The
// mint carries the org's active-brand count so account bills the overage on
// the first invoice instead of waiting for the next brand-count report.
describe('the mint carries the active-brand count', () => {
  it('sends activeBrands from the database, not from the client', async () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-1'
    process.env.ACCOUNT_URL = 'http://account.test'
    const fetchMock = vi.fn((_url: string, _init: { body: string }) =>
      Promise.resolve(new Response(JSON.stringify({ checkoutUrl: 'https://stripe.test/c' }))),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: 'https://studio.test' } }))
    try {
      await handler(authedEvent({ ...VALID_BODY, activeBrands: 1 }))
      const sent = JSON.parse(fetchMock.mock.calls[0]![1].body) as { activeBrands: number }
      expect(sent.activeBrands).toBe(12)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
