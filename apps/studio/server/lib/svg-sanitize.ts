// SVG-sanitering for logo-uploads (brand-assets).
//
// 🔴 LÆS DETTE FØR DU LØSNER CSP'EN PÅ /k ([sikkerhed] SIK-010):
//
// **CSP'en ER forsvaret. Denne sanitering er det ekstra lag — ikke omvendt.**
// En tidligere version af denne kommentar sagde at saniteringen fjerner de
// aktive vektorer og at CSP'en kom "derudover". Det var forkert vej rundt og
// farligt: den, der senere løsner CSP'en for et legitimt behov (fx et logo
// der skal kunne animere), ville læse det og konkludere at saniteringen
// dækker. Det gør den ikke.
//
// Regex mod HTML har strukturelle grænser. Verificeret mod vores egen kode
// 2026-08-04 — disse fire OVERLEVER saniteringen og er kun inerte fordi
// /k svarer med `CSP: sandbox; default-src 'none'` (sandbox uden
// allow-scripts slår scriptudførelse helt fra):
//   · <svg/onload=…>          — `/` er gyldig attribut-separator; vores
//                                mønster kræver whitespace før `on…`
//   · <svg:script>            — namespace-præfikset matcher ikke `<script`
//   · <animate attributeName="href" values="javascript:…">
//   · <set attributeName="onload" …>
//     ^ SMIL sætter attributter på RENDERTIDSPUNKTET; ingen af mønstrene
//       her ser på elementer, kun på attributter og blokke.
//
// svg-sanitize.test.ts har dem som eksplicitte "forventes at overleve"-
// cases, så begrænsningen er eksekverbar frem for kun beskrevet — og
// [file].test.ts asserterer på CSP-headeren, så et fjernet header giver
// rødt her frem for at blive opdaget af en kunde.
//
// Vil vi have saniteringen til at BÆRE forsvaret, skal den skiftes til en
// parser-baseret allowlist (fx DOMPurify i jsdom). Regexen nedenfor er
// bevidst en billig første barriere mod det almindelige, ikke en garanti.
//
// Trusselsmodellen: /k/{key}/logo.svg serveres fra app-origin hvor session-
// cookies bor — et SVG med script/handlers ville være stored XSS uden CSP'en.

const SCRIPT_BLOCKS = /<[a-z0-9]*:?script[\s\S]*?(?:<\/[a-z0-9]*:?script\s*>|$)/gi
const FOREIGN_OBJECT_BLOCKS = /<foreignObject[\s\S]*?(?:<\/foreignObject\s*>|$)/gi
// on*-attributter (onclick, onload, …) — begge quote-varianter + uquoted
const EVENT_HANDLER_ATTRS = /[\s/]on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
// javascript:-URL'er i href/xlink:href
const SCRIPT_URLS = /\s(?:xlink:)?href\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi
// Eksterne referencer: href/src mod andre origins (data:-URI'er i fx fills
// tillades — de er inerte i img-kontekst; http(s) fjernes så logoet aldrig
// kalder ud af huset, jf. first-party-only-baselinen)
const EXTERNAL_REFS = /\s(?:xlink:)?(?:href|src)\s*=\s*(?:"https?:[^"]*"|'https?:[^']*')/gi

export function sanitizeSvg(svg: string): string {
  let out = svg
  // Iterér til fixpoint: fjernelse af én blok kan blotlægge en ny (fx
  // "<scr<script>ipt>"-tricket) — uden loop ville ét pass kunne omgås.
  let prev: string
  do {
    prev = out
    out = out
      .replace(SCRIPT_BLOCKS, '')
      .replace(FOREIGN_OBJECT_BLOCKS, '')
      .replace(EVENT_HANDLER_ATTRS, '')
      .replace(SCRIPT_URLS, '')
      .replace(EXTERNAL_REFS, '')
  } while (out !== prev)
  return out
}

/** Grov struktur-validering før sanitering: skal ligne ét SVG-dokument. */
export function looksLikeSvg(content: string): boolean {
  const head = content.slice(0, 1000).trimStart()
  return /^(<\?xml[\s\S]{0,200}?\?>\s*)?(<!DOCTYPE[\s\S]{0,300}?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>/]/i.test(
    head,
  )
}
