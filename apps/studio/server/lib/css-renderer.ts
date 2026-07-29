import type { Tokens } from './tokens'

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
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

  return lines.join('\n') + '\n'
}
