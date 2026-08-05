import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const deletes: string[] = []
const updates: Array<{ table: string; values: Record<string, unknown> }> = []

vi.mock('~~/server/db', () => ({
  db: {
    // Optager sit ARGUMENT, ikke en hardkodet streng ([sikkerhed] SIK-006):
    // med `delete: () => …` kunne handleren slette en hvilken som helst tabel
    // uden at nogen test blev rød — assertionen så ud til at verificere HVAD
    // der blev tømt, men verificerede kun AT db.delete() blev kaldt. Bevist
    // med mutation: sletning af apiKey i stedet for projectMember lod alle
    // fem tests stå grønne.
    delete: (table: { _: { name: string } }) => ({
      where: () => {
        deletes.push(table._.name)
        return Promise.resolve()
      },
    }),
    update: (table: { _: { name: string } }) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table: table._.name, values })
          return Promise.resolve()
        },
      }),
    }),
  },
}))

vi.mock('~~/server/db/schema', () => ({
  projectMember: { _: { name: 'project_member' }, userId: 'userId' },
  apiKey: { _: { name: 'api_key' }, createdBy: 'createdBy' },
  configVersion: { _: { name: 'config_version' }, publishedBy: 'publishedBy' },
  activeVersion: { _: { name: 'active_version' }, activatedBy: 'activatedBy' },
  projectInvitation: { _: { name: 'project_invitation' }, invitedBy: 'invitedBy' },
}))

vi.mock('h3', () => ({
  defineEventHandler: (fn: unknown) => fn,
  getRequestHeader: (event: { headers?: Record<string, string> }, name: string) =>
    event?.headers?.[name.toLowerCase()] ?? null,
  readBody: (event: { body?: unknown }) => Promise.resolve(event?.body ?? null),
  createError: (opts: { statusCode: number; statusMessage?: string }) => {
    const err = new Error(opts.statusMessage ?? '') as Error & { statusCode: number }
    err.statusCode = opts.statusCode
    return err
  },
}))

const handler = (await import('./deleted.post')).default as unknown as (event: {
  headers?: Record<string, string>
  body?: unknown
}) => Promise<unknown>

const SECRET = 'test-deleted-secret'

describe('account deleted webhook', () => {
  const prior = process.env.ACCOUNT_DELETED_WEBHOOK_SECRET

  beforeEach(() => {
    deletes.length = 0
    updates.length = 0
    process.env.ACCOUNT_DELETED_WEBHOOK_SECRET = SECRET
  })

  afterAll(() => {
    if (prior === undefined) delete process.env.ACCOUNT_DELETED_WEBHOOK_SECRET
    else process.env.ACCOUNT_DELETED_WEBHOOK_SECRET = prior
  })

  it('503s when secret is not configured', async () => {
    delete process.env.ACCOUNT_DELETED_WEBHOOK_SECRET
    await expect(
      handler({ headers: { authorization: `Bearer ${SECRET}` }, body: { userId: 'u1' } }),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('401s without bearer token', async () => {
    await expect(handler({ body: { userId: 'u1' } })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('400s on invalid body', async () => {
    await expect(
      handler({ headers: { authorization: `Bearer ${SECRET}` }, body: {} }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('scrubs studio rows for the deleted user', async () => {
    const res = await handler({
      headers: { authorization: `Bearer ${SECRET}` },
      body: { userId: 'user-42' },
    })
    expect(res).toEqual({ ok: true, userId: 'user-42' })
    expect(deletes).toContain('project_member')
    expect(updates.length).toBe(4)
    const redacted = updates.map((u) => u.values)
    expect(redacted.every((v) => Object.values(v).includes('deleted@redacted'))).toBe(true)
  })

  // Bevisregistret må IKKE røres af kontosletning (jura §16): levetiden hører
  // til filens leverance + forældelsesfristen, ikke til brugerens konto.
  // Adfærden er allerede rigtig — men den var det ved et TILFÆLDE (tabellen
  // kom til efter webhooken), og holder kun indtil nogen udvider redaktionen
  // "for konsistens". Derfor pinnes den her frem for at bero på hukommelse.
  it('leaves the font licence attestation registry untouched', async () => {
    await handler({
      headers: { authorization: `Bearer ${SECRET}` },
      body: { userId: 'user-42' },
    })
    const touched = [...updates.map((u) => u.table), ...deletes]
    expect(touched).not.toContain('font_licence_attestation')
    // ...mens de fire denormaliserede email-felter fortsat ER redigeret:
    expect(updates.map((u) => u.table).sort()).toEqual([
      'active_version',
      'api_key',
      'config_version',
      'project_invitation',
    ])
  })
})
