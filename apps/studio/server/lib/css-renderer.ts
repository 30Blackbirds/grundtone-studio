import type { Tokens } from './tokens'

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/**
 * Render token JSON into a CSS file with custom properties on :root.
 * Mirrors the layout that @grundtone/vue's applyThemeToDOM sets — so
 * dropping the file in via <link> reproduces the same theme statically.
 */
export function renderTokensCss(tokens: Tokens): string {
  const lines: string[] = [':root {']

  if (tokens.colors) {
    for (const [key, value] of Object.entries(tokens.colors)) {
      if (value === undefined) continue
      lines.push(`  --color-${camelToKebab(key)}: ${value};`)
    }
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

  if (tokens.radius) {
    for (const [key, value] of Object.entries(tokens.radius)) {
      if (value === undefined) continue
      lines.push(`  --radius-${key}: ${value};`)
    }
  }

  lines.push('}')
  return lines.join('\n') + '\n'
}
