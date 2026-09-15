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
