#!/usr/bin/env node
/**
 * Udleder vilkaars-teksten til i18n fra [jura]s kildedokument.
 *
 * Hvorfor et script frem for at renskrive: 300 linjer tekst med RETSVIRKNING
 * kan ikke transskriberes forsvarligt i haanden — en tabt saetning har
 * konsekvens og ligner ingenting. Udledningen goer ogsaa juras én-kilde-krav
 * sandt ved KONSTRUKTION frem for ved disciplin: retter jura kilden, koerer vi
 * dette igen frem for at redigere to steder.
 *
 * Kilden er selv publicerbar ([jura] 0315f12): interne noter staar i
 * HTML-kommentarer, og det interne bilag er afgraenset med en markoer. Der er
 * derfor INGEN efterbehandling her — skal noget fjernes foer udgivelse, er det
 * en defekt i kilden, ikke noget dette script skal reparere.
 *
 * Brug:  node scripts/extract-terms.mjs ../../../docs/legal/studio-abonnementsvilkaar.md
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2];
if (!SRC) {
  console.error('brug: extract-terms.mjs <sti-til-kildedokument>');
  process.exit(1);
}
const MARKER = '<!-- INTERN-SEKTION-START';
// Ting der aldrig maa naa en kunde. Bemaerk at parenteser IKKE er forbudt:
// juridisk tekst bruger dem legitimt ("(§4.3)", "(reverse charge)"), og et
// parentes-forbud ville give falske positiver, man laerer at ignorere.
const BANNED = ['⚠', '[account]', '[grundtone]', '[jura]', 'docs/', '.md'];

const src = readFileSync(SRC, 'utf8');
if (!src.includes(MARKER)) {
  console.error(`FEJL: markoeren ${MARKER} mangler — er kilden aendret uden varsel?`);
  process.exit(1);
}

let body = src.slice(src.indexOf('## 1.'), src.indexOf(MARKER));
body = body.replace(/---\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');

const out = {};
const parts = body.split(/^## (\d+)\. (.+)$/m).slice(1);
for (let i = 0; i < parts.length; i += 3) {
  const [num, title, content] = [parts[i], parts[i + 1], parts[i + 2]];
  out[`s${num}h`] = title.trim();
  const paras = content.trim().split(/^(\d+)\.(\d+)\.\s+/m);
  paras[0]
    .split('\n')
    .filter((l) => l.trim().startsWith('- '))
    .forEach((b, bi) => (out[`s${num}b${bi + 1}`] = b.trim().slice(2).replace(/\s+/g, ' ').trim()));
  for (let j = 1; j < paras.length; j += 3) {
    const sub = paras[j + 1];
    const chunks = paras[j + 2].trim().split(/^([a-d])\)\s+/m);
    out[`s${num}p${sub}`] = chunks[0].replace(/\s+/g, ' ').trim();
    for (let k = 1; k < chunks.length; k += 2) {
      out[`s${num}p${sub}${chunks[k]}`] = chunks[k + 1].replace(/\s+/g, ' ').trim();
    }
  }
}

const blob = JSON.stringify(out);
const hits = BANNED.filter((b) => blob.includes(b));
if (hits.length) {
  console.error(
    `FEJL: kilden indeholder ting der ikke maa publiceres: ${hits.join(', ')}\n` +
      'Interne noter hoerer i <!-- HTML-kommentarer -->, aldrig i broedteksten\n' +
      '(juras femte krav i consent-tekster.md). Ret KILDEN, ikke dette script.',
  );
  process.exit(1);
}

writeFileSync(process.argv[3] ?? '/dev/stdout', `${JSON.stringify(out, null, 2)}\n`);
console.error(`${Object.keys(out).length} noegler udledt fra ${SRC}`);
