import { metrics, type Counter, type Meter } from '@opentelemetry/api'

// Studio's series from BILLING-METRICS-SPEC.md (LÅST — names/types/attrs are
// contract; extensions additive only, renames never). All four are AGGREGATES:
// no per-tenant attributes (spec regel 2 — the only per-tenant series,
// cdn_grace.expiry_time, is account's). Emitter errors must never affect the
// business flow (regel 4) — every helper is fire-and-forget and the whole
// module no-ops until the SDK plugin has initialised a real MeterProvider.

const METER_NAME = 'grundtone-studio.billing'

let meter: Meter | undefined
let quotaFailOpen: Counter | undefined
let quotaDenials: Counter | undefined
let cdnGraceCuts: Counter | undefined

function ensureInstruments(): void {
  if (meter) return
  meter = metrics.getMeter(METER_NAME)
  quotaFailOpen = meter.createCounter('klanghaus.studio.quota.fail_open', {
    unit: '{event}',
    description: 'Kvote-gate faldt tilbage til fail-open (§4) — alarm-serien for nede entitlements',
  })
  quotaDenials = meter.createCounter('klanghaus.studio.quota.denials', {
    unit: '{event}',
    description: 'Kvote-afvisninger (limit nået) — upgrade-funnel-signal, ikke fejl',
  })
  cdnGraceCuts = meter.createCounter('klanghaus.studio.cdn_grace.cuts', {
    unit: '{event}',
    description: 'Udførte 410-cuts (CDN-grace udløbet uden reactivate)',
  })
}

/**
 * Called by the telemetry plugin once the MeterProvider is registered.
 * The serving_brands gauge is an async observable — the callback runs on the
 * exporter's schedule, so the count query never sits in a request path.
 */
export function registerBillingMetrics(observeServingBrands: () => Promise<number>): void {
  ensureInstruments()
  meter!
    .createObservableGauge('klanghaus.studio.cdn_grace.serving_brands', {
      unit: '{brand}',
      description: 'Brands der aktuelt serveres i CDN-grace (suspenderet org, før cut)',
    })
    .addCallback(async (result) => {
      try {
        result.observe(await observeServingBrands())
      } catch {
        // regel 4: observability must never throw into the pipeline
      }
    })
}

export function recordQuotaFailOpen(
  quotaKey: string,
  reason: 'entitlements_unavailable' | 'cold_cache',
): void {
  try {
    ensureInstruments()
    quotaFailOpen!.add(1, { quota_key: quotaKey, reason })
  } catch {
    /* fire-and-forget */
  }
}

export function recordQuotaDenial(quotaKey: string): void {
  try {
    ensureInstruments()
    quotaDenials!.add(1, { quota_key: quotaKey })
  } catch {
    /* fire-and-forget */
  }
}

export function recordCdnGraceCut(): void {
  try {
    ensureInstruments()
    cdnGraceCuts!.add(1)
  } catch {
    /* fire-and-forget */
  }
}

// ─── Authorization availability (riff iub38z651y7nr21bovn0683w) ───────────
// Deliberately a SEPARATE meter: the billing series above are a locked
// contract, and this series is not billing. It counts PDP read checks that
// could not be answered (fail-closed 503), so an outage is visible as an
// outage instead of hiding among ordinary 403s. `reason` is a Connect code
// name or `transport` — a small closed set, no per-tenant attributes.
let pdpUnavailable: Counter | undefined

// 🔴 AN AUDIT WRITE THAT FAILS IS A GAP NOBODY CAN SEE. recordAuditEvent
// swallows every error by design — a failed insert must not break a publish —
// but that means the log can be incomplete with no signal at any of its 18 call
// sites. This counter is what turns that silence into a number.
//
// Additive under spec rule 1 (names/types/labels are locked against RENAMES;
// new metrics are explicitly allowed), and `action` is one of 23 known values,
// so rule 2's per-tenant cardinality ban does not apply. Fire-and-forget per
// rule 4: an emitter error must never reach the business flow.
export function recordAuditWriteFailed(action: string): void {
  try {
    ensureInstruments()
    meter!
      .createCounter('klanghaus.studio.audit.write_failed', {
        unit: '{event}',
        description: 'Audit-hændelser der IKKE blev skrevet (insert fejlede; requesten lykkedes)',
      })
      .add(1, { action })
  } catch {
    /* fire-and-forget */
  }
}

// An org-membership write that did not end where it should (lib/org-membership.ts).
// Every one fails CLOSED (too little access, never too much), so this is the
// signal that something needs a retry or the auth/org_member comparison.
// `reason` is one of four fixed values: unconfigured, auth_pending,
// restore_failed, not_recorded.
let orgWriteIncomplete: Counter | undefined
export function recordOrgWriteIncomplete(reason: string): void {
  try {
    orgWriteIncomplete ??= metrics
      .getMeter('grundtone-studio.authz')
      .createCounter('klanghaus.studio.org_write.incomplete', {
        unit: '{event}',
        description: 'Org membership writes that ended fail-closed, not as asked',
      })
    orgWriteIncomplete.add(1, { reason })
  } catch {
    /* fire-and-forget */
  }
}

export function recordPdpUnavailable(reason: string): void {
  try {
    pdpUnavailable ??= metrics
      .getMeter('grundtone-studio.authz')
      .createCounter('klanghaus.studio.pdp.unavailable', {
        unit: '{event}',
        description:
          'PDP-tjek kunne ikke besvares (udfald/transport) — fail-closed 503, ikke et afslag',
      })
    pdpUnavailable.add(1, { reason })
  } catch {
    /* fire-and-forget */
  }
}

// One run of the audit_log retention task (server/tasks/audit/retention.ts).
// `outcome` is ok|failed, two values, so no cardinality concern. A failed run
// is the event that matters: the retention periods are promises in the
// privacy policy, and a job that stops running breaks them silently. The
// absence of `ok` runs is what an alert should watch, not only `failed`.
let auditRetentionRuns: Counter | undefined
let auditRetentionRows: Counter | undefined
export function recordAuditRetentionRun(
  outcome: 'ok' | 'failed',
  rows: { stripped: number; deleted: number } = { stripped: 0, deleted: 0 },
): void {
  try {
    const m = metrics.getMeter('grundtone-studio.audit')
    auditRetentionRuns ??= m.createCounter('klanghaus.studio.audit.retention_runs', {
      unit: '{run}',
      description: 'Kørsler af audit_log-retention (IP/UA efter 90 dage, rækker efter 12 måneder)',
    })
    auditRetentionRows ??= m.createCounter('klanghaus.studio.audit.retention_rows', {
      unit: '{row}',
      description: 'Rækker berørt af audit_log-retention, pr. handling (stripped|deleted)',
    })
    auditRetentionRuns.add(1, { outcome })
    if (rows.stripped) auditRetentionRows.add(rows.stripped, { action: 'stripped' })
    if (rows.deleted) auditRetentionRows.add(rows.deleted, { action: 'deleted' })
  } catch {
    /* fire-and-forget */
  }
}
