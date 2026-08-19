import { describe, it, expect } from 'vitest'

/**
 * Privatlivspolitikkens §2.5 og §6 siger "Sentry, EU-region". Den sætning er
 * KUN sand, fordi DSN'en peger på `ingest.de.sentry.io` — regionen ligger i
 * en env-var, ikke i teksten. Skifter nogen Sentry-projekt eller region, bliver
 * to publicerede juridiske sætninger falske uden at teksten er rørt, og intet
 * review ville fange det: ændringen sker et sted ingen læser som "juridisk".
 *
 * [infra]-fund 2026-08-19. [jura] har bekræftet at teksten er korrekt i dag —
 * denne test er værnet mod at den holder op med at være det.
 *
 * Testen er BETINGET af at DSN'en er sat: lokalt og i PR-CI er den tom, og en
 * test der kræver en hemmelighed ville enten være rød for alle eller fristes
 * til at blive slået fra. Den måler dér hvor værdien findes.
 *
 * 🔴 DEN BÆRER IKKE DEN JURIDISKE SÆTNING ALENE — [infra]s korrektion: denne
 * test læser det miljø HVOR DEN KØRER, altså CI's env. Prod's værdi er en
 * anden, og det er prod's der havner i window.__NUXT__.config under §2.5's
 * påstand. Den rigtige måling sker i deploy-smoken i .github/workflows/
 * build.yml, som henter den SERVEREDE side og læser den DSN brugerne faktisk
 * får. Denne test er supplementet: den fanger en hardkodet DSN i koden.
 */
const EU_INGEST = /^https:\/\/[^@]+@[^.]+\.ingest\.de\.sentry\.io\//

describe('Sentry-regionen matcher privatlivspolitikkens §2.5', () => {
  const dsn = process.env.NUXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? ''

  it.skipIf(!dsn)('DSN peger på EU-ingest (ingest.de.sentry.io)', () => {
    expect(
      EU_INGEST.test(dsn),
      `DSN'en peger ikke på EU-ingest. Privatlivspolitikkens §2.5 og §6 siger ` +
        `"Sentry, EU-region" — enten skal DSN'en tilbage til de.-regionen, ` +
        `eller BEGGE tekster skal rettes (og [jura] involveres). Set: ` +
        `${dsn.replace(/\/\/[^@]+@/, '//<key>@')}`,
    ).toBe(true)
  })

  it('mønstret afviser en ikke-EU-region', () => {
    expect(EU_INGEST.test('https://abc@o123.ingest.us.sentry.io/456')).toBe(false)
    expect(EU_INGEST.test('https://abc@o123.ingest.sentry.io/456')).toBe(false)
    expect(EU_INGEST.test('https://abc@o123.ingest.de.sentry.io/456')).toBe(true)
  })
})
