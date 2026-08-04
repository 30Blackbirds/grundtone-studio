import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fontFileName } from './asset-upload'
import type { CURATED_FONTS } from './tokens'

// Kuraterede fonte (OFL, self-hostede via @fontsource-pakker — aldrig Google
// Fonts CDN, jf. selfhost-først-doktrinen). Publish kopierer de VALGTE vægte
// ind i projektets eget fonts/-præfiks, så kurateret og custom serveres
// uniformt via /k/{key}/fonts/... og tokens.css kan bruge relative url()'er
// der resolver mod CSS-filens egen placering. Latin-subset dækker dansk
// (æ/ø/å ligger i Latin-1 Supplement, som fontsource's latin inkluderer).

const _require = createRequire(import.meta.url)

const FONT_PACKAGES: Record<(typeof CURATED_FONTS)[number], string> = {
  'IBM Plex Sans': 'ibm-plex-sans',
  Inter: 'inter',
  'Source Sans 3': 'source-sans-3',
  'Work Sans': 'work-sans',
  Manrope: 'manrope',
  'Public Sans': 'public-sans',
}

export function isCuratedFamily(family: string): family is keyof typeof FONT_PACKAGES {
  return family in FONT_PACKAGES
}

/**
 * Læser én kurateret vægt fra @fontsource-pakken på disk. Kaster hvis
 * familien ikke er kurateret eller filen mangler i pakken — begge dele er
 * konfigurationsfejl der skal vælte publish højlydt, ikke give tavs 404
 * hos kunden.
 */
export async function readCuratedFont(family: string, weight: number): Promise<Buffer> {
  if (!isCuratedFamily(family)) {
    throw new Error(`Not a curated family: ${family}`)
  }
  const pkg = FONT_PACKAGES[family]
  const pkgRoot = _require.resolve(`@fontsource/${pkg}/package.json`)
  const file = pkgRoot.replace(/package\.json$/, `files/${pkg}-latin-${weight}-normal.woff2`)
  return readFile(file)
}

/** Reference-navnene publish skriver og CSS'en peger på — samme slug-regel som custom. */
export function curatedFontFiles(
  family: string,
  weights: number[],
  slot: 'heading' | 'body',
): Array<{ name: string; weight: number }> {
  return weights.map((weight) => ({ name: fontFileName(family, weight, slot), weight }))
}
