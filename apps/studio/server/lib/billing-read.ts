import { z } from 'zod'
import { PORTAL_KEY } from '~~/server/lib/entitlements'

// S2S read-relays for account's §7/§7a billing mirror (kontrakt:
// .orchestration/STUDIO-KVOTE-ENTITLEMENTS-KONTRAKT.md). Mirror-served on
// account's side (no live Stripe calls), pure read here: unavailable → null,
// the page shows a temporary-unavailable state — no gates are affected.
// Dormant-by-design like the entitlements client: no ACCOUNT_URL → null.

const subscriptionSchema = z.object({
  planKey: z.string(),
  planState: z.enum(['active', 'grace', 'suspended', 'canceled']),
  priceMinor: z.number(),
  currency: z.string(),
  interval: z.string(),
  renewsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  paymentMethod: z.object({ brand: z.string(), last4: z.string() }).nullable(),
})

const invoiceSchema = z.object({
  invoiceRef: z.string(),
  status: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  issuedAt: z.string(),
  hostedUrl: z.string().nullable(),
  pdfUrl: z.string().nullable(),
})

// §7: `200 { "invoices": [ … ] }` — an envelope, not a bare array, so account
// can add fields later. A bare array is rejected (→ null), not unwrapped.
const invoicesSchema = z.object({ invoices: z.array(invoiceSchema) })

export type BillingSubscription = z.infer<typeof subscriptionSchema>
export type BillingInvoice = z.infer<typeof invoiceSchema>

async function accountGet(path: string): Promise<unknown | null> {
  const baseUrl = process.env.ACCOUNT_URL
  if (!baseUrl) return null
  const headers: Record<string, string> = {}
  const token = process.env.ACCOUNT_S2S_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`account billing read responded ${res.status}`)
  return await res.json()
}

export async function getBillingSubscription(orgId: string): Promise<BillingSubscription | null> {
  try {
    const raw = await accountGet(
      `/v1/billing/${encodeURIComponent(orgId)}/subscription?portal=${PORTAL_KEY}`,
    )
    if (raw === null) return null
    const parsed = subscriptionSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`subscription response invalid: ${parsed.error.message}`)
    return parsed.data
  } catch (err) {
    console.error(`[billing-read] subscription fetch failed for org ${orgId}:`, err)
    return null
  }
}

export async function getBillingInvoices(
  orgId: string,
  limit = 24,
): Promise<BillingInvoice[] | null> {
  try {
    const raw = await accountGet(
      `/v1/billing/${encodeURIComponent(orgId)}/invoices?portal=${PORTAL_KEY}&limit=${limit}`,
    )
    if (raw === null) return null
    const parsed = invoicesSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`invoices response invalid: ${parsed.error.message}`)
    return parsed.data.invoices
  } catch (err) {
    console.error(`[billing-read] invoices fetch failed for org ${orgId}:`, err)
    return null
  }
}
