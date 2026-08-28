import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// §1a-ruling (jura): no Stripe session without active terms accept + business
// attestation — the 400 is a legal requirement, not incidental validation.

let nextOrg: {
  id: string
  members: { userId: string; role: string }[]
} | null = null

vi.mock('h3', () => {
  const base = mockH3()
  return {
    ...base,
    // The endpoint attaches machine-readable data ({code}) to errors — the
    // shared mock drops it, and the dormant-503 assertion needs it.
    createError: (opts: { statusCode: number; statusMessage?: string; data?: unknown }) => {
      const err = new Error(opts.statusMessage ?? '') as Error & {
        statusCode: number
        data?: unknown
      }
      err.statusCode = opts.statusCode
      err.data = opts.data
      return err
    },
  }
})
vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgBySlug: () => Promise.resolve(nextOrg),
}))
// The handler pulls orgRoleHelpers from project-access, whose module graph
// drags in the live db/pdp clients — stub the transitive deps, keep the real
// role logic in play via the actual import below.
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('~~/server/lib/pdp', () => ({ checkOrg: vi.fn(), checkProject: vi.fn() }))

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

  it('403s for roles without billing rights', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 403 })
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

    delete process.env.STUDIO_INTERNAL_ORG_IDS
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

    delete process.env.STUDIO_INTERNAL_ORG_IDS
  })

  // Undtagelsen hviler på org-id'et fra auth, ikke på noget klienten sender.
  it('lader ikke et org slippe forbi ved at ligne et internt i bodyen', async () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-internal'
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'owner' }] }

    await expect(
      handler(authedEvent({ ...VALID_BODY, organizationSlug: 'org-internal' })),
    ).rejects.toMatchObject({ statusCode: 403, data: { code: 'beta_paid_plans_closed' } })

    delete process.env.STUDIO_INTERNAL_ORG_IDS
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
