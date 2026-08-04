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

// Brand-assets (schema låst m/ [designer] 2026-08-03, forlæg
// redesign-brand-assets.html). Referencer er RELATIVE filnavne resolvet mod
// /k/{key}/ af konsumenten — stramme mønstre så en reference aldrig kan bære
// path-traversal eller absolutte URL'er ind i delivery-laget.
const logoFile = z.string().regex(/^logo\.(svg|png)$/, 'must be logo.svg or logo.png')
const fontFile = z.string().regex(/^fonts\/[a-z0-9-]+\.woff2$/, 'must be fonts/<slug>.woff2')

// v1-listen af kuraterede fonte (OFL, SELF-hostede — aldrig Google Fonts CDN).
export const CURATED_FONTS = [
  'IBM Plex Sans',
  'Inter',
  'Source Sans 3',
  'Work Sans',
  'Manrope',
  'Public Sans',
] as const

export const FONT_WEIGHTS = [400, 500, 600, 700] as const

const fontWeight = z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)])

// Discriminated på source: kurateret = family fra v1-listen, filer leveres af
// os; custom = én .woff2 pr. vægt (schemaets file er singular by design —
// flere vægte = flere uploads, maks. 4), og files-nøglerne skal matche weights.
const webFont = z
  .discriminatedUnion('source', [
    z
      .object({
        source: z.literal('curated'),
        family: z.enum(CURATED_FONTS),
        weights: z.array(fontWeight).min(1).max(4),
      })
      .strict(),
    z
      .object({
        source: z.literal('custom'),
        family: z.string().min(1).max(100),
        weights: z.array(fontWeight).min(1).max(4),
        files: z.record(z.string(), fontFile),
      })
      .strict(),
  ])
  .superRefine((font, ctx) => {
    if (new Set(font.weights).size !== font.weights.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'weights must be unique' })
    }
    if (font.source === 'custom') {
      const fileWeights = Object.keys(font.files).sort()
      const weights = font.weights.map(String).sort()
      if (fileWeights.join(',') !== weights.join(',')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'files must have exactly one entry per selected weight',
        })
      }
    }
  })

export const tokensSchema = z
  .object({
    colors: colorGroup.optional(),
    assets: z
      .object({
        logo: z
          .object({
            file: logoFile,
            type: z.enum(['svg', 'png']),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
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
        webFont: webFont.optional(),
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
