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
export const TERMS_URL = 'https://grundtone.com/vilkaar'
export const PRIVACY_URL = 'https://grundtone.com/privatliv'
export const WITHDRAWAL_URL = 'https://grundtone.com/fortrydelse'
