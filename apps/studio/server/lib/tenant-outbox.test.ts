import { describe, expect, it, vi } from 'vitest'

vi.mock('../db', () => ({ db: {} }))
const { backoffMs, buildTenantProvisioned, classifyPublishResponse, earliest, PUBLISH_PATH } =
  await import('./tenant-outbox')

// The pure halves of the outbox: the wire form account decodes, the plan-time
// rule, and how each Publish answer is handled. The database halves are in
// tenant-outbox.pg.test.ts.

describe('buildTenantProvisioned', () => {
  const at = new Date('2026-09-01T10:00:00Z')
  const now = new Date('2026-10-27T12:00:00Z')

  it('is the eventcontract v1 proto-JSON Event account decodes', () => {
    expect(buildTenantProvisioned('key-1', { id: 'org-1', slug: 'acme' }, at, now)).toEqual({
      idempotencyKey: 'key-1',
      occurredAt: '2026-10-27T12:00:00.000Z',
      producer: 'PRODUCER_GRUNDTONE_STUDIO',
      tenantProvisioned: {
        tenant: { tenantId: 'org-1', slug: 'acme', portalKey: 'grundtone-studio' },
        paymentModel: 'PAYMENT_MODEL_SUBSCRIPTION',
        provisionedAt: '2026-09-01T10:00:00.000Z',
      },
    })
  })

  it('omits the slug when it is unknown rather than sending an empty one', () => {
    const e = buildTenantProvisioned('k', { id: 'org-1' }, at, now) as {
      tenantProvisioned: { tenant: Record<string, unknown> }
    }
    expect(e.tenantProvisioned.tenant).toEqual({ tenantId: 'org-1', portalKey: 'grundtone-studio' })
  })

  it('sends the producer as its proto NAME, never a number (0 = UNSPECIFIED)', () => {
    const e = buildTenantProvisioned('k', { id: 'o' }, at, now)
    expect(typeof e.producer).toBe('string')
  })

  it('targets the Connect path of AccountIngestService.Publish', () => {
    expect(PUBLISH_PATH).toBe('/klanghaus.platform.eventcontract.v1.AccountIngestService/Publish')
  })
})

describe('earliest (the provisioned_at rule: err early, §3)', () => {
  const now = new Date('2026-10-27T12:00:00Z')

  it('takes the earliest valid evidence', () => {
    expect(earliest(['2026-05-01T00:00:00Z', new Date('2026-03-01T00:00:00Z'), null], now)).toEqual(
      new Date('2026-03-01T00:00:00Z'),
    )
  })

  it('ignores an unparseable value instead of letting it become "now"', () => {
    expect(earliest(['not a date', '2026-04-01T00:00:00Z'], now)).toEqual(
      new Date('2026-04-01T00:00:00Z'),
    )
  })

  it('falls back to now only when there is no evidence at all', () => {
    expect(earliest([undefined, null, 'garbage'], now)).toEqual(now)
  })
})

describe('classifyPublishResponse (account src/ingest/connect-routes.ts)', () => {
  it('200 accepted → delivered', () => {
    expect(classifyPublishResponse(200, { accepted: true })).toEqual({
      kind: 'delivered',
      duplicate: false,
    })
  })

  it('200 duplicate → delivered (a replay account has already applied)', () => {
    expect(classifyPublishResponse(200, { duplicate: true })).toEqual({
      kind: 'delivered',
      duplicate: true,
    })
  })

  it('🔴 200 that neither accepts nor recognises it is NOT a delivery', () => {
    expect(classifyPublishResponse(200, {})).toMatchObject({ kind: 'retry' })
  })

  it('400 → park: malformed is permanent, resending would loop forever', () => {
    expect(classifyPublishResponse(400, { code: 'invalid_argument' })).toMatchObject({
      kind: 'park',
    })
  })

  it.each([401, 500, 501, 502, 503])('%i → retry', (status) => {
    expect(classifyPublishResponse(status, null)).toMatchObject({ kind: 'retry' })
  })
})

describe('backoffMs', () => {
  it('doubles from 30 s and caps at an hour', () => {
    expect(backoffMs(1)).toBe(30_000)
    expect(backoffMs(2)).toBe(60_000)
    expect(backoffMs(20)).toBe(60 * 60_000)
  })
})
