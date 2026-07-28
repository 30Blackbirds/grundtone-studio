import type { Tokens } from '~~/server/lib/tokens'

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/**
 * Convert a project's token JSON into a map of CSS custom properties, mirroring
 * server/lib/css-renderer.ts exactly (--color-*, --space-*, --radius-*,
 * --font-family-*). Applied as an inline `style` on a wrapper so a project's
 * theme is scoped to a preview region instead of the whole document — the
 * @grundtone components inside then render in that project's brand.
 */
export function tokensToCssVars(
  tokens: Partial<Tokens> | null | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {}
  if (!tokens) return vars

  for (const [key, value] of Object.entries(tokens.colors ?? {})) {
    if (value) vars[`--color-${camelToKebab(key)}`] = String(value)
  }
  for (const [key, value] of Object.entries(tokens.spacing ?? {})) {
    if (value) vars[`--space-${key}`] = String(value)
  }
  for (const [key, value] of Object.entries(tokens.radius ?? {})) {
    if (value) vars[`--radius-${key}`] = String(value)
  }
  for (const [key, value] of Object.entries(tokens.typography?.fontFamily ?? {})) {
    if (value) vars[`--font-family-${key}`] = String(value)
  }
  return vars
}
