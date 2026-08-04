import { looksLikeSvg, sanitizeSvg } from './svg-sanitize'
import type { Tokens } from './tokens'

// Upload-validering for brand-assets (forlægget redesign-brand-assets.html):
// 512 KB-caps og format-tjek på MAGIC BYTES, ikke filendelser — endelsen er
// klient-kontrolleret og beviser intet. SVG saniteres FØR lagring, så der
// aldrig ligger et usaniteret dokument i storage (defence-in-depth ift.
// /k-delivery-CSP'en).

export const MAX_ASSET_BYTES = 512 * 1024

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WOFF2_MAGIC = Buffer.from('wOF2', 'ascii')

export type LogoValidation =
  | { ok: true; type: 'svg'; body: string; contentType: 'image/svg+xml' }
  | { ok: true; type: 'png'; body: Buffer; contentType: 'image/png' }
  | { ok: false; error: 'too_large' | 'unsupported_format' }

export function validateLogoUpload(data: Buffer): LogoValidation {
  if (data.length > MAX_ASSET_BYTES) return { ok: false, error: 'too_large' }
  if (data.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ok: true, type: 'png', body: data, contentType: 'image/png' }
  }
  const text = data.toString('utf8')
  if (looksLikeSvg(text)) {
    return { ok: true, type: 'svg', body: sanitizeSvg(text), contentType: 'image/svg+xml' }
  }
  return { ok: false, error: 'unsupported_format' }
}

export type FontValidation =
  | { ok: true; body: Buffer; contentType: 'font/woff2' }
  | { ok: false; error: 'too_large' | 'unsupported_format' }

export function validateFontUpload(data: Buffer): FontValidation {
  if (data.length > MAX_ASSET_BYTES) return { ok: false, error: 'too_large' }
  if (!data.subarray(0, 4).equals(WOFF2_MAGIC)) return { ok: false, error: 'unsupported_format' }
  return { ok: true, body: data, contentType: 'font/woff2' }
}

/**
 * Font-fil-slug fra familienavn + vægt → `fonts/<slug>-<weight>.woff2`.
 * Skal producere navne der består tokens-schemaets fontFile-mønster
 * (^fonts/[a-z0-9-]+\.woff2$) uanset input — deraf den hårde normalisering
 * og fallback når navnet ikke efterlader noget brugbart.
 */
/**
 * Asset-referencer i tokens der skal promoveres draft → v{n}/ + current/
 * ved publish (logo + custom-font-filer). Kuraterede fonte har ingen filer
 * her — de serveres fra vores fælles self-host-lag (delivery-slicen).
 */
export function referencedAssets(tokens: Tokens): Array<{ name: string; contentType: string }> {
  const out: Array<{ name: string; contentType: string }> = []
  const logo = tokens.assets?.logo
  if (logo) {
    out.push({ name: logo.file, contentType: logo.type === 'svg' ? 'image/svg+xml' : 'image/png' })
  }
  const font = tokens.typography?.webFont
  if (font?.source === 'custom') {
    for (const name of Object.values(font.files)) {
      out.push({ name, contentType: 'font/woff2' })
    }
  }
  return out
}

export function fontFileName(family: string, weight: number): string {
  const slug =
    family
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'font'
  return `fonts/${slug}-${weight}.woff2`
}
