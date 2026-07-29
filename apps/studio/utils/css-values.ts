// Single source for CSS value validation — the zod schema (server/lib/
// tokens.ts) and the editor's inline validation (UX-audit finding #8) must
// agree, so both import these patterns instead of keeping copies in sync.

export const CSS_COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\)|[a-z-]+|var\(--[\w-]+\))$/

export const CSS_LENGTH_PATTERN = /^[\d.]+(px|rem|em|%|vh|vw|ch|ex|cm|mm|in|pt|pc)?$/

export function isCssColor(value: string): boolean {
  return value.length > 0 && value.length <= 100 && CSS_COLOR_PATTERN.test(value)
}

export function isCssLength(value: string): boolean {
  return value.length > 0 && value.length <= 40 && CSS_LENGTH_PATTERN.test(value)
}
