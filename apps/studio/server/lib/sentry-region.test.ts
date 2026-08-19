import { describe, it, expect } from 'vitest'

/**
 * Mønster-enhedstest for Sentry-regionen. Læs den anden kommentar først:
 *
 * 🔴 INVARIANTEN BOR IKKE HER. Privatlivspolitikkens §2.5 og §6 siger
 * "Sentry, EU-region", og det er sandt præcis fordi DSN'en peger på
 * `ingest.de.sentry.io`. Den værdi findes KUN i prod — og prod kører ikke
 * vitest. Den måling sker i prod-deploy-smoken (.github/workflows/build.yml),
 * som henter den SERVEREDE side og læser den DSN brugerne faktisk får.
 *
 * Første udgave af denne fil havde en `it.skipIf(!dsn)`-test der læste
 * `process.env`. Målt ([infra] 2026-08-19): nul workflows sætter DSN'en, og
 * prod-imaget kører ingen tests — så den sprang over i HVERT miljø der findes.
 * En vagt der kun kan sige ja er værre end ingen vagt: den ser ud som dækning.
 * Den er fjernet frem for at blive "repareret" med en env-var i CI, for så
 * ville den måle CI's konfiguration og påstå noget om prods.
 *
 * Det der bliver tilbage er ægte og lille: mønstret selv. Deploy-smoken bruger
 * samme regel, så en fejl i regexen ville ellers gøre BEGGE blinde.
 */
const EU_INGEST = /^https:\/\/[^@]+@[^.]+\.ingest\.de\.sentry\.io\//

describe('EU_INGEST-mønstret', () => {
  it('accepterer en de-region-DSN', () => {
    expect(EU_INGEST.test('https://abc@o123.ingest.de.sentry.io/456')).toBe(true)
  })

  it('afviser en us-region-DSN', () => {
    expect(EU_INGEST.test('https://abc@o123.ingest.us.sentry.io/456')).toBe(false)
  })

  it('afviser den regions-løse vært — det er den lette at overse', () => {
    expect(EU_INGEST.test('https://abc@o123.ingest.sentry.io/456')).toBe(false)
  })

  it('afviser en vært der blot INDEHOLDER .de. et forkert sted', () => {
    expect(EU_INGEST.test('https://abc@o123.ingest.de.evil.example/456')).toBe(false)
    expect(EU_INGEST.test('https://abc@de.sentry.io/456')).toBe(false)
  })
})
