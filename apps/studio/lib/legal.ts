// Legal config for the checkout flow (§1a-ruling, jura 2026-08-02).
//
// TERMS_VERSION is the accept-proof version stamped into the checkout-session
// mint (accounts §8-krav: termsAccepted {version, acceptedAt}) — bump it when
// docs/legal/studio-abonnementsvilkaar.md gets a new ratified version. The
// value is deliberately a plain string owned here so [jura]'s versioning
// scheme can change without touching flow code.
//
// URLs are config: the public vilkår/privatliv pages ship with the
// grundtone.com web pipeline — until then these point at the canonical
// upcoming paths ([docs] owns publishing).
export const TERMS_VERSION = 'studio-tos-1.0'
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
export const TERMS_URL = 'https://grundtone.com/vilkaar'
export const PRIVACY_URL = 'https://grundtone.com/privatliv'
export const WITHDRAWAL_URL = 'https://grundtone.com/fortrydelse'
