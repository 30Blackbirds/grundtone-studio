import { deliverDue } from '~~/server/lib/tenant-outbox'

// Scheduled every minute in nuxt.config.ts (`nitro.scheduledTasks`). Sends due
// tenant_event_outbox rows to account's ingest; server/lib/tenant-outbox.ts has
// the retry, lease and park rules. Dormant (nothing sent, rows kept) until both
// ACCOUNT_URL and ACCOUNT_INGEST_TOKEN are set.
export default defineTask({
  meta: {
    name: 'outbox:deliver',
    description: 'tenant_event_outbox: publish due events to account (AccountIngestService)',
  },
  async run() {
    const result = await deliverDue()
    // Quiet when there was nothing to do; one line when something moved.
    if (result.delivered + result.retried + result.parked > 0) {
      console.info('[tenant-outbox]', JSON.stringify(result))
    }
    return { result }
  },
})
