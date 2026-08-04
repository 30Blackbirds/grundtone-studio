// SVG-sanitering for logo-uploads (brand-assets, låst design 2026-08-03).
// Trusselsmodellen: /k/{key}/logo.svg serveres fra app-origin hvor session-
// cookies bor — et SVG med script/handlers er stored XSS. Forsvaret er
// LAGDELT: denne sanitering fjerner de aktive vektorer, og /k-routen sætter
// derudover CSP sandbox + nosniff (delivery-laget). Whitelist-parsere er
// overkill her: SVG'et renderes kun i <img>-kontekst af vores egne flader,
// så opgaven er at neutralisere dokumentet, ikke at bevare alt eksotisk.

const SCRIPT_BLOCKS = /<script[\s\S]*?(?:<\/script\s*>|$)/gi
const FOREIGN_OBJECT_BLOCKS = /<foreignObject[\s\S]*?(?:<\/foreignObject\s*>|$)/gi
// on*-attributter (onclick, onload, …) — begge quote-varianter + uquoted
const EVENT_HANDLER_ATTRS = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
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
