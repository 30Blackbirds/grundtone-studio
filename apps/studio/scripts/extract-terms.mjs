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

// ─── Krav 1: STRIKSHED FREM FOR OVERBAERENHED ([jura], consent-tekster.md) ──
//
// Kan en nummereret paragrafoverskrift ikke parses, skal vi FEJLE — ikke
// springe over. [review] demonstrerede hvorfor: fjern punktummet i "9.2." og
// den tidligere version droppede en ansvarsklausul med exit 0, mens teksten
// blev klistret ind i den foregaaende paragraf. Ingen forbudt term, intet
// roedt, og selv en gennemlaesning saa en sammenhaengende paragraf.
//
// Baggrunden for at barren er hoejere her end de fleste steder er juras:
// vores bevis-spor goer defekten SELV-BEKRAEFTENDE. Falder en klausul ud,
// viser vi kunden en aftale uden den — og registrerer samtidig, at de
// accepterede praecis dét, med korrekt versionslabel og tidsstempel. Beviset
// ville bekraefte den forkerte tekst.
//
// Vi leder derfor efter linjer, der LIGNER en nummereret bestemmelse, men
// ikke matcher det stramme moenster. Én saadan linje stopper udtraekket.
const CLAUSE_STRICT = /^\d+\.\d+\.\s+\S/;
// Praecis nok til at undgaa falske positiver: et paragraf-nummer har 1-2
// cifre paa hver side. Et dansk tusindtalsseparator har PRAECIS 3 cifre efter
// punktummet ("1.000 kr." i §14.2), saa det falder udenfor. En vagt med
// falske positiver bliver ignoreret — samme grund som [jura] afviste et
// parentes-forbud i den forbudte-term-liste.
const CLAUSE_LOOSE = /^\d{1,2}[.,]\d{1,2}[.,]?\s/;
const malformed = body
  .split('\n')
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => CLAUSE_LOOSE.test(line) && !CLAUSE_STRICT.test(line));
if (malformed.length) {
  console.error(
    'FEJL: linjer ligner en nummereret bestemmelse, men kan ikke parses:\n' +
      malformed.map(([n, l]) => `  linje ${n}: ${l.slice(0, 70)}`).join('\n') +
      '\n\nEn tavs udeladelse i tekst med retsvirkning er vaerre end et brud.\n' +
      'Ret KILDEN — formatet er "N.M. tekst" med punktum efter begge tal.',
  );
  process.exit(1);
}

// ─── Versionen udledes af kilden, ikke skrevet i haanden ────────────────────
//
// 🔴 [jura] fandt, at versionsstrengen fandtes i TRE haandholdte kopier:
// locale-filens `versionLine` (det kunden SER), `lib/legal.ts`'s TERMS_VERSION
// (det vi GEMMER i bevis-sporet) og kilden. Teksten var sikret ved
// konstruktion; LABELEN paa teksten var sikret ved disciplin.
//
// Konsekvensen er den selv-bekraeftende defekt i renest form: vi kunne vise
// kunden 1.1-teksten, skrive "Version 1.0" nederst og gemme "1.0" i
// bevis-sporet — alle tre led internt konsistente, hele attesten forkert.
//
// Derfor udledes den her. Mangler linjen, fejler udtraekket — samme regel som
// for bestemmelserne: en tavs udeladelse i tekst med retsvirkning er vaerre
// end et brud.
const versionMatch = /^\*\*Version:\*\*\s*`([a-z0-9.-]+)`/m.exec(src);
if (!versionMatch) {
  console.error(
    'FEJL: kunne ikke finde versionslinjen i kilden.\n' +
      'Forventet format: **Version:** `studio-tos-N.N` · **Gaelder fra:** …\n' +
      'Versionen maa ikke skrives i haanden — den er labelen paa et bindende dokument.',
  );
  process.exit(1);
}
const VERSION = versionMatch[1];

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

// 🔴 vue-i18n: en RAA @ i en locale-streng er linked-message-syntaks og
// knaekker builden med "error code: 10". Den har ramt os tre gange — og
// hverken tests eller typecheck ser den, kun builden. Mailadresser i juras
// tekst escapes derfor her, saa fejlen ikke kan opstaa igen: {'@'} renderer
// som et almindeligt @.
for (const k of Object.keys(out)) {
  out[k] = out[k].replace(/(?<!\{')@(?!'\})/g, "{'@'}");
}

// ─── Krav 2: UBRUDT PARAGRAF-SEKVENS ────────────────────────────────────────
// Viser HVILKEN paragraf der mangler, ikke blot at antallet er skredet — og
// kraever ingen manuelt vedligeholdt optaelling, som den, der lige har tabt en
// paragraf, ellers bare ville opdatere.
const seen = Object.keys(out)
  .map((k) => /^s(\d+)h$/.exec(k)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i <= (seen.at(-1) ?? 0); i++) if (!seen.includes(i)) gaps.push(i);
const dupes = seen.filter((n, i) => seen.indexOf(n) !== i);
if (gaps.length || dupes.length || seen[0] !== 1) {
  console.error(
    `FEJL: paragraf-sekvensen er brudt. Fundet: ${seen.join(', ')}` +
      (gaps.length ? `\n  MANGLER: §${gaps.join(', §')}` : '') +
      (dupes.length ? `\n  DUBLETTER: §${dupes.join(', §')}` : ''),
  );
  process.exit(1);
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

// Baade maskin-vaerdien (bevis-sporet) og den viste linje kommer fra samme
// udledning, saa de ikke kan skride fra hinanden.
out.version = VERSION;
out.versionLine = `Version ${VERSION} \u00b7 Grundtone Studio`;

writeFileSync(process.argv[3] ?? '/dev/stdout', `${JSON.stringify(out, null, 2)}\n`);
console.error(`${Object.keys(out).length} noegler udledt fra ${SRC}`);
