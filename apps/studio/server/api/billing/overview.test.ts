import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// Da preamblen blev trukket ud i org-request.ts, blev VALGET af gate et
// argument frem for fire linjer kode. Det gør en svækkelse billigere: ét ord
// (`'billing'` → `'lookup-only'`) åbner fakturahistorik og beløb for ethvert
// medlem. Mutationstest bekræftede at intet fangede den ændring. Denne fil
// pinner gaten for DETTE endepunkt.

let nextOrg: { id: string; members?: { userId: string; role: string }[] } | null = null

vi.mock('h3', () => mockH3())
vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgBySlug: () => Promise.resolve(nextOrg),
}))
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('~~/server/lib/pdp', () => ({ checkOrg: vi.fn(), checkProject: vi.fn() }))
vi.mock('~~/server/lib/billing-read', () => ({
  getBillingSubscription: () => Promise.resolve({ planKey: 'studio_solo', status: 'active' }),
  getBillingInvoices: () => Promise.resolve([{ id: 'in_1' }]),
}))

const handler = (await import('./overview.get')).default as unknown as (
  event: FakeEvent,
) => Promise<{ available: boolean; memberCount: number }>

function authedEvent(query: Record<string, string>): FakeEvent {
  return fakeEvent({
    query,
    context: { auth: { sub: 'user-1', tenant: 'org-1', email: 'user-1@acme.test' } },
  })
}

beforeEach(() => {
  nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'owner' }] }
})

describe('GET /api/billing/overview', () => {
  it('401s without auth', async () => {
    await expect(
      handler(fakeEvent({ query: { organizationSlug: 'acme' }, context: {} })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('400s on an empty organizationSlug (query, ikke body)', async () => {
    await expect(handler(authedEvent({ organizationSlug: '' }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('404s when the scoped lookup resolves to no org', async () => {
    nextOrg = null
    await expect(handler(authedEvent({ organizationSlug: 'ukendt' }))).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  // 🔴 Fakturabeløb og betalingshistorik er billing-data, ikke almindelig
  // org-info. Et blot medlem må ikke se dem.
  it('403s a plain member — overblikket er billing-gated, ikke medlems-gated', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
    await expect(handler(authedEvent({ organizationSlug: 'acme' }))).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Requires the owner or billing role',
    })
  })

  // POSITIV KONTROL: uden den kunne gaten være i stykker og afvise alt.
  it('svarer med overblikket for en billing-berettiget rolle', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'billing' }] }
    await expect(handler(authedEvent({ organizationSlug: 'acme' }))).resolves.toMatchObject({
      available: true,
      memberCount: 1,
    })
  })
})
