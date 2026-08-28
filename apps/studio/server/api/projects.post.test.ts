import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// Gaten på projekt-oprettelse er `member` — med SIK-003-defaulten: mangler
// medlemslisten, er svaret nej. Efter ekstraktionen ligger den beslutning i ét
// ord i kaldet til requireOrg, og mutationstest viste at INTET fangede en
// ændring til `'lookup-only'`. Denne fil måler gaten; oprettelsens happy path
// (db-indsættelse, PDP-grants, rollback, kvote) er bevidst ikke dækket her.

let nextOrg: { id: string; members?: { userId: string; role: string }[] } | null = null

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({ eq: () => null }))
vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgBySlug: () => Promise.resolve(nextOrg),
}))
// Gaten fyrer FØR noget af dette bliver brugt — tomme stubs er nok, og at de
// er tomme er selv en assertion: rammer en test dem, er gaten sprunget over.
vi.mock('~~/server/db', () => ({ db: {} }))
vi.mock('~~/server/db/schema', () => ({ project: { _: { name: 'project' } } }))
vi.mock('~~/server/lib/pdp', () => ({
  checkOrg: vi.fn(),
  checkProject: vi.fn(),
  linkProjectToOrg: vi.fn(),
  grantProjectRole: vi.fn(),
}))
vi.mock('~~/server/lib/audit', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('~~/server/lib/entitlements', () => ({
  getStudioEntitlements: vi.fn(),
  evaluateProjectQuota: vi.fn(),
}))
vi.mock('~~/server/lib/metrics', () => ({
  recordQuotaDenial: vi.fn(),
  recordQuotaFailOpen: vi.fn(),
}))

const handler = (await import('./projects.post')).default as unknown as (
  event: FakeEvent,
) => Promise<unknown>

const VALID_BODY = { name: 'Main', slug: 'main', organizationSlug: 'acme' }

function authedEvent(body: Record<string, unknown>): FakeEvent {
  return fakeEvent({
    body,
    context: { auth: { sub: 'user-1', tenant: 'org-1', email: 'user-1@acme.test' } },
  })
}

beforeEach(() => {
  nextOrg = { id: 'org-1', members: [{ userId: 'user-1', role: 'member' }] }
})

describe('POST /api/projects — adgangsgaten', () => {
  it('401s without auth', async () => {
    await expect(handler(fakeEvent({ body: VALID_BODY, context: {} }))).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('400s on a slug that breaks the pattern', async () => {
    await expect(
      handler(authedEvent({ ...VALID_BODY, slug: 'Ikke Lovlig' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('404s when the scoped lookup resolves to no org', async () => {
    nextOrg = null
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 404 })
  })

  // 🔴 Opslaget alene er IKKE gaten her: det kan svare for et org, hvor
  // kalderen ikke står i den opløste medlemsliste. Slækkes gaten til
  // `lookup-only`, bliver denne rød.
  it('403s en kalder der ikke står i den opløste medlemsliste', async () => {
    nextOrg = { id: 'org-1', members: [{ userId: 'en-anden', role: 'owner' }] }
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Not a member of this organization',
    })
  })

  // 🔴 SIK-003 på selve ruten: mangler medlemslisten, ved vi ikke om kalderen
  // er medlem — og så er svaret nej, ikke ja.
  it('403s når medlemslisten mangler helt (SIK-003)', async () => {
    nextOrg = { id: 'org-1' }
    await expect(handler(authedEvent(VALID_BODY))).rejects.toMatchObject({ statusCode: 403 })
  })

  // 🔴 POSITIV KONTROL. Uden den kunne gaten afvise ALT og stadig se rigtig
  // ud ovenfor. Et faktisk medlem skal NÅ FORBI gaten — det ses ved, at
  // kaldet nu fejler længere nede, på de tomme db-stubs, i stedet for med
  // 401/403/404 fra preamblen.
  it('lader et faktisk medlem passere gaten (fejler først længere nede)', async () => {
    const err = await handler(authedEvent(VALID_BODY)).then(
      () => null,
      (e: { statusCode?: number }) => e,
    )
    expect(err).not.toBeNull()
    expect(err?.statusCode).toBeUndefined()
  })
})
