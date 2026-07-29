import { z } from 'zod'
import { CSS_COLOR_PATTERN, CSS_LENGTH_PATTERN } from '~~/utils/css-values'

const cssColor = z.string().min(1).max(100).regex(CSS_COLOR_PATTERN, 'must be a valid CSS color')

const cssLength = z.string().min(1).max(40).regex(CSS_LENGTH_PATTERN, 'must be a valid CSS length')

const colorGroup = z
  .object({
    primary: cssColor.optional(),
    primaryLight: cssColor.optional(),
    primaryDark: cssColor.optional(),
    onPrimary: cssColor.optional(),
    secondary: cssColor.optional(),
    success: cssColor.optional(),
    warning: cssColor.optional(),
    error: cssColor.optional(),
    info: cssColor.optional(),
    background: cssColor.optional(),
    surface: cssColor.optional(),
    surfaceRaised: cssColor.optional(),
    text: cssColor.optional(),
    textSecondary: cssColor.optional(),
    textTertiary: cssColor.optional(),
  })
  .partial()

export const tokensSchema = z
  .object({
    colors: colorGroup.optional(),
    typography: z
      .object({
        fontFamily: z
          .object({
            base: z.string().min(1).max(200).optional(),
            heading: z.string().min(1).max(200).optional(),
            mono: z.string().min(1).max(200).optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    radius: z
      .object({
        sm: cssLength.optional(),
        md: cssLength.optional(),
        lg: cssLength.optional(),
        xl: cssLength.optional(),
      })
      .partial()
      .optional(),
    spacing: z
      .object({
        sm: cssLength.optional(),
        md: cssLength.optional(),
        lg: cssLength.optional(),
      })
      .partial()
      .optional(),
    // Dark-override layer (decision 2026-07-29: override model, not a full
    // second set). Holds ONLY the tokens that differ in dark mode — v1 scopes
    // that to colors, which is what realistically diverges. Absent/empty dark
    // = the pre-existing single-set behaviour, so old payloads stay valid and
    // old SDKs simply ignore the extra key.
    dark: z.object({ colors: colorGroup.optional() }).strict().optional(),
  })
  .strict()

export type Tokens = z.infer<typeof tokensSchema>

/**
 * Effective tokens for a mode. Dark = base with dark.colors merged over
 * colors; the `dark` layer itself never leaks into the resolved shape.
 */
export function resolveMode(tokens: Tokens, mode: 'light' | 'dark'): Omit<Tokens, 'dark'> {
  const { dark, ...base } = tokens
  if (mode === 'light' || !dark?.colors || Object.keys(dark.colors).length === 0) return base
  return { ...base, colors: { ...base.colors, ...dark.colors } }
}

export const DEFAULT_TOKENS: Tokens = {
  colors: {
    primary: '#4F46E5',
    primaryLight: '#818CF8',
    primaryDark: '#3730A3',
    onPrimary: '#FFFFFF',
    secondary: '#0EA5E9',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
    background: '#FFFFFF',
    surface: '#F9FAFB',
    surfaceRaised: '#FFFFFF',
    text: '#111827',
    textSecondary: '#4B5563',
    textTertiary: '#9CA3AF',
  },
  typography: {
    fontFamily: {
      base: 'Inter, system-ui, sans-serif',
      heading: 'Inter, system-ui, sans-serif',
      mono: 'JetBrains Mono, monospace',
    },
  },
  radius: {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
  },
  spacing: {
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
  },
}
