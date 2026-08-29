import { describe, expect, it, afterEach, vi } from 'vitest'
import { assertBetaPurchasesClosed } from './beta-purchases'

// Håndhævelsespunktet for begge billing-endepunkter. `checkout-session` har
// egne tests af HELE ruten; her testes kontrakten selv, fordi
// `portal-session.post.ts` ikke har nogen testfil og ellers kun ville være
// dækket i anden hånd.

afterEach(() => {
  delete process.env.STUDIO_INTERNAL_ORG_IDS
  vi.restoreAllMocks()
})

describe('assertBetaPurchasesClosed', () => {
  it('afviser med juras kode og status', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertBetaPurchasesClosed('org-udefra', 'checkout')).toThrowError(
      expect.objectContaining({
        statusCode: 403,
        data: { code: 'beta_paid_plans_closed' },
      }),
    )
  })

  // Positiv kontrol: uden den ville testen ovenfor også bestå mod en
  // implementering der afviser ALT — inklusive dem undtagelsen er til for.
  it('lader et internt org passere', () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-intern'
    expect(() => assertBetaPurchasesClosed('org-intern', 'checkout')).not.toThrow()
  })

  it('er tom liste når variablen ikke er sat — ingen undtagelse', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertBetaPurchasesClosed('org-intern', 'checkout')).toThrow()
  })

  // 🔴 Loggen må ikke bære klientens tekst. Det er auth-id'et der logges.
  it('logger det org-id den fik, ikke andet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertBetaPurchasesClosed('org-abc', 'portal-session')).toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('org=org-abc'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('portal-session'))
  })
})
