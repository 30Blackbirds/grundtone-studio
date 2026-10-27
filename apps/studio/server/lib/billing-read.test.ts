import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBillingInvoices, getBillingSubscription } from './billing-read'

// Pins the wire shapes against account's locked §7 contract
// (.orchestration/STUDIO-KVOTE-ENTITLEMENTS-KONTRAKT.md). The invoices read
// once parsed a bare array, so the contract's `{ invoices: [...] }` envelope
// was rejected and every billing page showed "temporarily unavailable".

const invoice = {
  invoiceRef: 'in_1',
  status: 'paid',
  amountMinor: 14900,
  currency: 'DKK',
  issuedAt: '2026-10-01T00:00:00Z',
  hostedUrl: null,
  pdfUrl: null,
}

const subscription = {
  planKey: 'studio-free',
  planState: 'active',
  priceMinor: 0,
  currency: 'DKK',
  interval: 'month',
  renewsAt: null,
  cancelAtPeriodEnd: false,
  paymentMethod: null,
}

let body: unknown
let status = 200

beforeEach(() => {
  vi.stubEnv('ACCOUNT_URL', 'http://account.test')
  status = 200
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getBillingInvoices', () => {
  it('reads the §7 envelope', async () => {
    body = { invoices: [invoice] }
    expect(await getBillingInvoices('org-1')).toEqual([invoice])
  })

  it('reads an empty envelope as an empty list, not as unavailable', async () => {
    body = { invoices: [] }
    expect(await getBillingInvoices('org-1')).toEqual([])
  })

  it('rejects a bare array (the pre-contract shape) as unavailable', async () => {
    body = [invoice]
    expect(await getBillingInvoices('org-1')).toBeNull()
  })

  it('is unavailable on a non-2xx', async () => {
    body = { invoices: [invoice] }
    status = 404
    expect(await getBillingInvoices('org-1')).toBeNull()
  })
})

describe('getBillingSubscription', () => {
  it('reads a free org with no subscription row (§3 effective plan)', async () => {
    body = subscription
    expect(await getBillingSubscription('org-1')).toEqual(subscription)
  })

  it('reads suspended as a known state', async () => {
    body = { ...subscription, planState: 'suspended' }
    expect(await getBillingSubscription('org-1')).toMatchObject({ planState: 'suspended' })
  })

  it('rejects a Stripe status that §7 never sends', async () => {
    body = { ...subscription, planState: 'past_due' }
    expect(await getBillingSubscription('org-1')).toBeNull()
  })
})
