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
// Regex mod HTML har strukturelle grænser. De vektorer der stadig overlever
// — og som derfor kræver CSP'en — er pinnet i `uncaught`-blokken i
// `svg-sanitize.test.ts`; læs dem dér frem for her, så listen ikke kan drive
// fra koden. SIK-010-opstramningen lukkede `<svg/onload=>` og `<svg:script>`;
// SMIL-vektorerne (`animate`/`set` mod `href`/`onload`) overlever fortsat.
//
// De overlevende er kun inerte fordi /k svarer med
// `CSP: sandbox; default-src 'none'` (sandbox uden allow-scripts slår
// scriptudførelse helt fra) — og `[...file].test.ts` asserterer på den header,
// så et fjernet header giver rødt her frem for at blive opdaget af en kunde.
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

// 🔴 SIK-014 (ReDoS, 2026-08-11). Den tidligere udgave brugte
// `(<!--[\s\S]*?-->\s*)*` — en stjernemarkeret gruppe hvis krop kan matche
// HEN OVER sin egen afslutning. Motoren kan derfor dele en raekke kommentarer
// op paa eksponentielt mange maader, og hver ekstra kommentar FORDOBLER
// arbejdet. Maalt: 20 kommentarer (162 bytes) = 7,9 ms · 30 (241 bytes) = ~8
// sekunder. 1000-tegns-loftet tillader ~124 kommentarer — loftet er ikke en
// beskyttelse, det er rigeligt til at goere kaldet praktisk uendeligt.
//
// Ruten er `POST /api/projects/[projectId]/assets/logo` bag `editor`-adgang,
// men Free-tier giver egne projekter, saa barren er "enhver med en konto".
// Og Nitro er single-threaded: et blokeret regex-kald rammer ALLE tenants paa
// den worker, ikke kun angriberens egen session.
//
// Fixet er ikke "hurtigere regex" — det fjerner TVETYDIGHEDEN. Hver del kan
// nu kun matche paa én maade:
//   `(?:[^-]|-(?!->))*`  en kommentarkrop kan ikke aede sin egen `-->`
//   `(?:[^?]|\?(?!>))*`  samme for XML-deklarationens `?>`
//   `[^>]*`              doctype stopper ved foerste `>`
// En hurtigere regex med samme tvetydighed flytter graensen; den fjerner den
// ikke. Se den tidsbundne test i svg-sanitize.test.ts — en korrekthedstest
// kan IKKE fange det her, fordi funktionen returnerer det rigtige svar.
const SVG_PROLOGUE =
  /^(?:<\?xml(?:[^?]|\?(?!>))*\?>\s*)?(?:<!DOCTYPE[^>]*>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*<svg[\s>/]/i

/** Grov struktur-validering før sanitering: skal ligne ét SVG-dokument. */
export function looksLikeSvg(content: string): boolean {
  return SVG_PROLOGUE.test(content.slice(0, 1000).trimStart())
}
