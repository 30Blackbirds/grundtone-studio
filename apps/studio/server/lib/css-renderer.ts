import { fontFileName } from './asset-upload'
import { FALLBACK_STACKS, type FontSlot, type Tokens } from './tokens'

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/**
 * Font-familienavn saa det kan staa i en CSS-streng.
 *
 * 🔴 Det er en BLOKLISTE, ikke en allowliste — kaldt ved sit rigtige navn
 * efter [copilot] fangede, at kommentaren paastod det modsatte. (Tredje gang
 * i denne PR-serie at en kommentar lover noget koden ikke er; en allowliste
 * ville kraeve at oplistes hvilke tegn der MAA staa, og det kan vi ikke uden
 * at afvise legitime navne paa CJK, kyrillisk og accenttegn.)
 *
 * Den gamle form fjernede KUN apostroffer: et navn der ender paa `\` escaper
 * den afsluttende apostrof, og et raat linjeskift lukker streng-tokenet, saa
 * resten parses som ny CSS. Skemaet afviser nu de tegn (tokens.ts), men
 * rendereren skriver CSS'en og maa vaere korrekt af sig selv — ikke fordi et
 * andet lag opfoerer sig ordentligt.
 */
function cssFamilyName(family: string): string {
  return family.replace(/[\p{C}\p{Zl}\p{Zp}\\'"]/gu, '')
}

/**
 * @font-face-blokke + font-family-kæde for ét font-slot (to-slot-revisionen
 * 2026-08-04). url()'erne er RELATIVE — de resolver mod CSS-filens egen
 * placering (/k/{key}/tokens.css → /k/{key}/fonts/...), så samme CSS virker
 * uanset origin/nøgle. Kæden følger forlægget: primær, fallback-stakkene i
 * valgt rækkefølge, og det generiske nøgleord udledt af SIDSTE fallback.
 */
function fontFaceBlocks(slot: FontSlot, slotKey: 'heading' | 'body'): string[] {
  const out: string[] = []
  for (const weight of [...slot.weights].sort((a, b) => a - b)) {
    const file =
      slot.source === 'custom'
        ? slot.files[String(weight)]
        : fontFileName(slot.family, weight, slotKey)
    out.push(
      '',
      '@font-face {',
      `  font-family: '${cssFamilyName(slot.family)}';`,
      '  font-style: normal;',
      `  font-weight: ${weight};`,
      '  font-display: swap;',
      `  src: url('${file}') format('woff2');`,
      '}',
    )
  }
  return out
}

/** CSS font-family-kæden for et slot — spejles 1:1 af UI'ets kæde-feedback. */
export function fontFamilyChain(slot: FontSlot): string {
  const parts = [`'${cssFamilyName(slot.family)}'`]
  for (const key of slot.fallbacks) {
    parts.push(...FALLBACK_STACKS[key].fonts)
  }
  const last = slot.fallbacks[slot.fallbacks.length - 1]
  parts.push(FALLBACK_STACKS[last].generic)
  return parts.join(', ')
}

function colorLines(colors: NonNullable<Tokens['colors']>, indent: string): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(colors)) {
    if (value === undefined) continue
    out.push(`${indent}--color-${camelToKebab(key)}: ${value};`)
  }
  return out
}

/**
 * Render token JSON into a CSS file with custom properties on :root.
 * Mirrors the layout that @grundtone/vue's applyThemeToDOM sets — so
 * dropping the file in via <link> reproduces the same theme statically.
 */
export function renderTokensCss(tokens: Tokens): string {
  const lines: string[] = [':root {']

  if (tokens.colors) {
    lines.push(...colorLines(tokens.colors, '  '))
  }

  if (tokens.spacing) {
    for (const [key, value] of Object.entries(tokens.spacing)) {
      if (value === undefined) continue
      lines.push(`  --space-${key}: ${value};`)
    }
  }

  if (tokens.typography?.fontFamily) {
    for (const [key, value] of Object.entries(tokens.typography.fontFamily)) {
      if (value === undefined) continue
      lines.push(`  --font-family-${key}: ${value};`)
    }
  }

  // Font-slots (Font 1/overskrift + Font 2/brødtekst) sætter kæde-vars —
  // heading-slottet vinder over et manuelt fontFamily.heading (og body over
  // .base): slots ER den kuraterede måde at styre familierne på; de rå
  // strenge består kun som avanceret/legacy-håndtag.
  const slots = tokens.typography?.slots
  if (slots?.heading) lines.push(`  --font-family-heading: ${fontFamilyChain(slots.heading)};`)
  if (slots?.body) lines.push(`  --font-family-base: ${fontFamilyChain(slots.body)};`)

  if (tokens.radius) {
    for (const [key, value] of Object.entries(tokens.radius)) {
      if (value === undefined) continue
      lines.push(`  --radius-${key}: ${value};`)
    }
  }

  lines.push('}')

  // Dark-override block (override model, 2026-07-29): only the colors that
  // differ. Two selectors mirror the SDK's mode semantics — OS preference via
  // the media query unless the host explicitly pinned light, and an explicit
  // opt-in via [data-gt-mode="dark"] that wins regardless of OS setting.
  const darkColors = tokens.dark?.colors
  if (darkColors && Object.values(darkColors).some((v) => v !== undefined)) {
    lines.push('')
    lines.push('@media (prefers-color-scheme: dark) {')
    lines.push(`  :root:not([data-gt-mode='light']) {`)
    lines.push(...colorLines(darkColors, '    '))
    lines.push('  }')
    lines.push('}')
    lines.push('')
    lines.push(`:root[data-gt-mode='dark'] {`)
    lines.push(...colorLines(darkColors, '  '))
    lines.push('}')
  }

  if (slots?.heading) lines.push(...fontFaceBlocks(slots.heading, 'heading'))
  if (slots?.body) lines.push(...fontFaceBlocks(slots.body, 'body'))

  return lines.join('\n') + '\n'
}
