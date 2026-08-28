import { describe, it, expect, vi, beforeEach } from 'vitest'
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

  // 🔴 Gør purchasable-tjekkets LATENS eksekverbar. Tjekket i handleren er i
  // dag en død gren, fordi enummet kun admitterer købbare planer — og en død
  // gren siger intet om, hvor den skal stå. Kommer en ikke-købbar nøgle ind i
  // enummet, bliver DENNE rød, og så skal placeringen (400 fra tjekket vs 404
  // fra org-opslaget) besluttes bevidst frem for at skifte tavst.
  it.each([...CHECKOUT_PLAN_KEYS])(
    'lader planen %s passere purchasable-tjekket',
    async (planKey) => {
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

  it('503s dormant when ACCOUNT_URL is unset — with a fully valid body', async () => {
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'billing_unavailable' },
    })
  })
})
