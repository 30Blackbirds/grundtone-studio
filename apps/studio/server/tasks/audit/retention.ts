import { applyAuditRetention } from '~~/server/lib/audit-retention'
import { recordAuditRetentionRun } from '~~/server/lib/metrics'

// Scheduled hourly in nuxt.config.ts (`nitro.scheduledTasks`). The periods and
// why the cut-offs sit one day before each deadline: server/lib/audit-retention.ts.
export default defineTask({
  meta: {
    name: 'audit:retention',
    description: 'audit_log: strip IP/user agent after 90 days, delete rows after 12 months',
  },
  async run() {
    try {
      const result = await applyAuditRetention()
      recordAuditRetentionRun('ok', result)
      // One structured line per run: the dated run result the acceptance
      // criterion asks for (counts + cut-offs), readable in the container log.
      console.info('[audit-retention]', JSON.stringify(result))
      return { result }
    } catch (err) {
      recordAuditRetentionRun('failed')
      console.error('[audit-retention] run FAILED', err)
      throw err
    }
  },
})
