import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const inserts: Array<Record<string, unknown>> = []

vi.mock('~~/server/db', () => {
  const insert = () => ({
    values: (row: Record<string, unknown>) => {
      inserts.push(row)
      return Promise.resolve()
    },
  })
  return { db: { insert } }
})
vi.mock('~~/server/db/schema', () => ({ emailEvent: {} }))

// h3 isn't a direct dep — stub the helpers we use, same pattern as audit.test.ts.
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

// EventHandler's signature carries Nitro typing we don't need in tests; cast
// via unknown to a plain function that takes the fake event we construct.
const handler = (await import('./webhook.post')).default as unknown as (event: {
  headers?: Record<string, string>
  body?: unknown
}) => Promise<unknown>

const USER = 'pm_user'
const PASS = 'pm_pass'
const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

describe('postmark webhook receiver', () => {
  // Capture the env vars before the suite touches them so we can restore
  // afterwards. Otherwise the test would leak USER/PASS into the global
  // env and any later suite that reads them.
  const priorUser = process.env.POSTMARK_WEBHOOK_USER
  const priorPass = process.env.POSTMARK_WEBHOOK_PASS

  beforeEach(() => {
    inserts.length = 0
    process.env.POSTMARK_WEBHOOK_USER = USER
    process.env.POSTMARK_WEBHOOK_PASS = PASS
  })

  afterAll(() => {
    if (priorUser === undefined) delete process.env.POSTMARK_WEBHOOK_USER
    else process.env.POSTMARK_WEBHOOK_USER = priorUser
    if (priorPass === undefined) delete process.env.POSTMARK_WEBHOOK_PASS
    else process.env.POSTMARK_WEBHOOK_PASS = priorPass
  })

  it('500s when secrets are not configured', async () => {
    delete process.env.POSTMARK_WEBHOOK_USER
    await expect(
      handler({ headers: { authorization: basic(USER, PASS) }, body: {} }),
    ).rejects.toMatchObject({ statusCode: 500 })
  })

  it('401s on missing Authorization header', async () => {
    await expect(handler({ body: {} })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('401s on wrong credentials', async () => {
    await expect(
      handler({ headers: { authorization: basic(USER, 'wrong') }, body: {} }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('401s on malformed Basic header (no colon)', async () => {
    const bad = `Basic ${Buffer.from('nocolons').toString('base64')}`
    await expect(handler({ headers: { authorization: bad }, body: {} })).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('400s when Recipient and Email are both missing', async () => {
    await expect(
      handler({ headers: { authorization: basic(USER, PASS) }, body: { RecordType: 'Delivery' } }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('persists a Delivery event with Postmark fields normalized', async () => {
    const res = await handler({
      headers: { authorization: basic(USER, PASS) },
      body: {
        RecordType: 'Delivery',
        MessageID: 'msg-1',
        Recipient: 'allan@example.com',
        DeliveredAt: '2026-05-19T08:00:00Z',
      },
    })
    expect(res).toEqual({ ok: true })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      messageId: 'msg-1',
      recipient: 'allan@example.com',
      eventType: 'Delivery',
      bounceType: null,
      description: null,
    })
  })

  it('captures bounce type + description on a Bounce event', async () => {
    await handler({
      headers: { authorization: basic(USER, PASS) },
      body: {
        RecordType: 'Bounce',
        MessageID: 'msg-2',
        Email: 'allan@example.com',
        Type: 'HardBounce',
        Description: 'The server was unable to deliver your message',
      },
    })
    expect(inserts[0]).toMatchObject({
      messageId: 'msg-2',
      recipient: 'allan@example.com',
      eventType: 'Bounce',
      bounceType: 'HardBounce',
      description: 'The server was unable to deliver your message',
    })
  })

  it('falls back to Email when Recipient is missing (older Postmark payloads)', async () => {
    await handler({
      headers: { authorization: basic(USER, PASS) },
      body: { RecordType: 'SpamComplaint', Email: 'spammed@example.com' },
    })
    expect(inserts[0]).toMatchObject({
      recipient: 'spammed@example.com',
      eventType: 'SpamComplaint',
    })
  })
})
