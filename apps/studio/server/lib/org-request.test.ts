import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// Den delte preamble testes DIREKTE her, ikke kun gennem de fem endepunkter.
// Ellers ville gaterne kun være dækket i anden hånd, og en ekstraktion der
// svækkede én af dem kunne overleve, så længe hvert endepunkt tilfældigvis
// ramte en anden gren.

let nextOrg: { id: string; members?: { userId: string; role: string }[] } | null = null

vi.mock('h3', () => mockH3())
vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgBySlug: () => Promise.resolve(nextOrg),
}))
// project-access trækker den levende db/pdp-graf med; stub transitive deps og
// behold den ægte rolle-logik (canManageBilling) i spil.
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('~~/server/lib/pdp', () => ({ checkOrg: vi.fn(), checkProject: vi.fn() }))

const { requireAuthedRequest, requireOrg } = await import('./org-request')

const schema = z.object({ organizationSlug: z.string().min(1) })
const ACTOR = { sub: 'user-1', tenant: 'org-1', email: 'user-1@acme.test' }
const ev = (e: FakeEvent) => e as unknown as H3Event

function authed(): FakeEvent {
  return fakeEvent({ context: { auth: ACTOR } })
}

beforeEach(() => {
  nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'owner' }] }
})

describe('requireAuthedRequest', () => {
  it('401er uden verificeret actor', () => {
    expect(() =>
      requireAuthedRequest(ev(fakeEvent({ context: {} })), schema, { organizationSlug: 'acme' }),
    ).toThrowError(expect.objectContaining({ statusCode: 401 }))
  })

  it('400er når input ikke matcher skemaet', () => {
    expect(() => requireAuthedRequest(ev(authed()), schema, { organizationSlug: '' })).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('giver actor og parsed data igennem ved gyldigt input', () => {
    const { actor, data } = requireAuthedRequest(ev(authed()), schema, {
      organizationSlug: 'acme',
    })
    expect(actor.sub).toBe('user-1')
    expect(data.organizationSlug).toBe('acme')
  })

  // Rækkefølgen: auth FØR validering. Ellers ville en uautentificeret kalder
  // kunne aflæse vores skema ved at sende skrald og se hvilket felt der brokker
  // sig — en 400 fortæller mere end en 401 gør.
  it('svarer 401 før 400 når begge fejler', () => {
    expect(() =>
      requireAuthedRequest(ev(fakeEvent({ context: {} })), schema, { organizationSlug: '' }),
    ).toThrowError(expect.objectContaining({ statusCode: 401 }))
  })
})

describe('requireOrg', () => {
  it('404er når opslaget ikke giver en org', async () => {
    nextOrg = null
    await expect(requireOrg(ev(authed()), ACTOR, 'ukendt', 'billing')).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('lookup-only: opslaget ER gaten, ingen rolle kræves', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
    await expect(requireOrg(ev(authed()), ACTOR, 'acme', 'lookup-only')).resolves.toMatchObject({
      id: 'org-1',
    })
  })

  it('member: slipper et faktisk medlem igennem', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
    await expect(requireOrg(ev(authed()), ACTOR, 'acme', 'member')).resolves.toMatchObject({
      id: 'org-1',
    })
  })

  it('member: 403er en kalder der ikke står i medlemslisten', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'someone-else', role: 'owner' }] }
    await expect(requireOrg(ev(authed()), ACTOR, 'acme', 'member')).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Not a member of this organization',
    })
  })

  // 🔴 SIK-003. Mangler medlemslisten helt, ved vi ikke om kalderen er medlem —
  // og så er svaret nej. `?? true` ville give adgang præcis i det tilfælde hvor
  // vi vidste mindst. Uden denne test er defaulten frit omflyttelig.
  it('member: 403er når medlemslisten mangler helt (SIK-003)', async () => {
    nextOrg = { id: 'org-1' }
    await expect(requireOrg(ev(authed()), ACTOR, 'acme', 'member')).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it.each(['owner', 'billing'])('billing: slipper rollen %s igennem', async (role) => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role }] }
    await expect(requireOrg(ev(authed()), ACTOR, 'acme', 'billing')).resolves.toMatchObject({
      id: 'org-1',
    })
  })

  it.each(['member', 'admin', 'manager'])('billing: 403er rollen %s', async (role) => {
    nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role }] }
    await expect(requireOrg(ev(authed()), ACTOR, 'acme', 'billing')).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Requires the owner or billing role',
    })
  })

  it('billing: 403er når medlemslisten mangler helt', async () => {
    nextOrg = { id: 'org-1' }
    await expect(requireOrg(ev(authed()), ACTOR, 'acme', 'billing')).rejects.toMatchObject({
      statusCode: 403,
    })
  })
})
