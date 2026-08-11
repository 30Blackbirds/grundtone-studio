// Legal config for the checkout flow (§1a-ruling, jura 2026-08-02).
//
// 🔴 TERMS_VERSION er den version, bevis-sporet gemmer (accounts §8-krav:
// termsAccepted {version, acceptedAt}). Den UDLEDES nu af kilden i stedet for
// at blive skrevet i haanden.
//
// [jura] fandt, at strengen fandtes i TRE haandholdte kopier: her, i locale-
// filens `versionLine` (det kunden SER) og i kilden. Teksten var sikret ved
// konstruktion — labelen paa teksten var sikret ved disciplin. Det er den
// selv-bekraeftende defekt i renest form: vi kunne vise 1.1-teksten, skrive
// "Version 1.0" nederst og gemme "1.0" i beviset. Alle tre led internt
// konsistente, hele attesten forkert.
//
// Nu kommer begge fra scripts/extract-terms.mjs, som laeser versionslinjen i
// docs/legal/studio-abonnementsvilkaar.md. Vil du bumpe versionen: ret KILDEN
// og koer udtraekket. Retter du den her, skrider den fra det, kunden ser.
import da from '~~/i18n/locales/da.json'

export const TERMS_VERSION = (da.terms as { version: string }).version
// B2B-erklæringen (jura §0, tekst LÅST i commit 340e4f5) har sit EGET
// bevisspor — to retsvirkninger, to versioner (juras krav 1+3).
export const ATTESTATION_VERSION = 'studio-b2b-erklaering-2026-08-02'
// Font-licens-erklæringen (jura-ruling 104d174 + consent-tekster.md): egen
// retsvirkning → eget bevisspor og egen version. Versionen bor HER ved siden
// af selve teksten i i18n (brandAssets.license) — juras krav 1 "én kilde":
// ændres ordlyden, skal denne bumpes i samme diff, og tests/legal-copy.test.ts
// pinner ordlydens substans så en ændring ikke kan ske ubemærket.
export const FONT_LICENCE_VERSION = 'studio-font-licence-1.0'
// Retention for bevis-rækken (jura §16a): slettes N år efter at filen SIDST
// blev serveret — uanset hvorfor leveringen ophørte. 10 år er det konservative
// valg: 3-årsfristen løber ved ukendskab først fra det tidspunkt rettighedshaveren
// BURDE være blevet bekendt, og en skriftproducent opdager sjældent med det samme
// — regnet fra vores egen sidste leverance ville vi slette beviset i præcis den
// periode hvor kravet realistisk dukker op.
//
// ⚠️ Konfigurerbar med vilje: juras anvendelse af forældelsesreglerne på en
// VEDVARENDE immaterialretskrænkelse er sendt til advokat-verifikation, og Allan
// får 10-vs-5-år forelagt som risikoappetit-valg. Tallet kan ændre sig én gang;
// logikken (servingEndedAt + frist) er uændret uanset udfald.
export const ATTESTATION_RETENTION_YEARS = 10

// Den dag bevisregistret først kunne indeholde en række: migration 0010 gik
// live med v0.2.15. Ingen `servingEndedAt` kan derfor være ældre end dette,
// og den ALLERTIDLIGSTE dato hvor en række overhovedet kan blive sletbar er
// denne + ATTESTATION_RETENTION_YEARS.
export const ATTESTATION_REGISTRY_LIVE_SINCE = '2026-08-04'

// Sweepet der udfører sletningen er bevidst ikke bygget endnu: intet bliver
// sletbart i et årti, og det der hastede var at URET blev rigtigt fra dag ét
// (et forkert ur kan ikke repareres bagudrettet; et manglende sweep kan
// bygges når som helst).
//
// Men [jura] §16b har ret i at den reelle risiko ikke er juridisk — den er
// INSTITUTIONEL GLEMSEL: om ti år er der ingen der husker denne beslutning.
// Derfor er fraværet gjort DETEKTERBART frem for husket. Sæt dette flag til
// true i samme PR som sweepet lander, og se legal-retention.test.ts.
export const ATTESTATION_SWEEP_IMPLEMENTED = false
export const TERMS_URL = 'https://grundtone.com/vilkaar'
export const PRIVACY_URL = 'https://grundtone.com/privatliv'
export const WITHDRAWAL_URL = 'https://grundtone.com/fortrydelse'
