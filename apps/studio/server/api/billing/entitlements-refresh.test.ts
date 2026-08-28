import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// Modstykket til overview-testen: her skal gaten IKKE strammes. At buste en
// cache er harmløst ud over selve medlemskabet, og `lookup-only` er derfor
// det rigtige valg — men et valg, der før lå i koden og nu ligger i et ord.
// Uden denne fil ville en "oprydning" til `'billing'` gøre knappen på
// checkout-success-siden ubrugelig for alle andre end ejeren, uden rødt.

const cleared: string[] = []
let nextOrg: { id: string; members?: { userId: string; role: string }[] } | null = null

vi.mock('h3', () => mockH3())
vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgBySlug: () => Promise.resolve(nextOrg),
}))
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('~~/server/lib/pdp', () => ({ checkOrg: vi.fn(), checkProject: vi.fn() }))
vi.mock('~~/server/lib/entitlements', () => ({
  clearEntitlementsCacheFor: (orgId: string) => cleared.push(orgId),
}))

const handler = (await import('./entitlements-refresh.post')).default as unknown as (
  event: FakeEvent,
) => Promise<{ ok: boolean }>

function authedEvent(body: Record<string, unknown>): FakeEvent {
  return fakeEvent({
    body,
    context: { auth: { sub: 'user-1', tenant: 'org-1', email: 'user-1@acme.test' } },
  })
}

beforeEach(() => {
  cleared.length = 0
  nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
})

describe('POST /api/billing/entitlements-refresh', () => {
  it('401s without auth', async () => {
    await expect(
      handler(fakeEvent({ body: { organizationSlug: 'acme' }, context: {} })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('400s on an empty organizationSlug', async () => {
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

  // 🔴 Det medlemsskabs-scopede opslag ER gaten her. Et almindeligt medlem
  // SKAL kunne buste cachen — strammes gaten til `billing`, bliver denne rød.
  it('lader et almindeligt medlem buste cachen (opslaget er gaten)', async () => {
    await expect(handler(authedEvent({ organizationSlug: 'acme' }))).resolves.toEqual({ ok: true })
    expect(cleared).toEqual(['org-1'])
  })

  // Cachen bustes på org-id'et fra AUTH-opslaget, ikke på noget klienten
  // sender — samme princip som beta-værnets org-id.
  it('buster på org-id fra opslaget, ikke på slug fra bodyen', async () => {
    nextOrg = { id: 'org-rigtig', members: [{ userId: 'user-1', role: 'member' }] }
    await handler(authedEvent({ organizationSlug: 'noget-andet' }))
    expect(cleared).toEqual(['org-rigtig'])
  })
})
