import { describe, it, expect } from 'vitest'
import {
  recordQuotaFailOpen,
  recordQuotaDenial,
  recordCdnGraceCut,
  recordPdpUnavailable,
  registerBillingMetrics,
} from './metrics'

// Spec regel 4: emitter-fejl må ALDRIG påvirke forretningsflowet. Without an
// initialised MeterProvider the OTel API hands out no-op instruments — every
// helper must be safely callable in that (dormant) state, because the gate/cut
// paths call them unconditionally.
describe('billing metrics (fire-and-forget)', () => {
  it('all recorders are no-op-safe without a MeterProvider', () => {
    expect(() => {
      recordQuotaFailOpen('studio.projects', 'entitlements_unavailable')
      recordQuotaFailOpen('studio.projects', 'cold_cache')
      recordQuotaDenial('studio.projects')
      recordCdnGraceCut()
      recordPdpUnavailable('Unavailable')
      recordPdpUnavailable('transport')
    }).not.toThrow()
  })

  it('registerBillingMetrics swallows observer errors (regel 4)', async () => {
    expect(() =>
      registerBillingMetrics(async () => {
        throw new Error('db down')
      }),
    ).not.toThrow()
  })
})
