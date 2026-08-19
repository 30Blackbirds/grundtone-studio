import type { ColorSlot } from '~~/server/lib/tokens'

// Gruppering af core's farveslots til TokenEditor — [designer]s forlæg
// docs/design/grundtone/brand/token-editor-grouping.md (2026-08-19).
// Princip: 39 felter må aldrig vises som 39 felter. Brugeren træffer ~9
// beslutninger (base); resten er "afledte" bag en toggle pr. gruppe.
//
// 🔴 "Afledt" betyder i dag IKKE "beregnet": @grundtone/core's createTheme
// er ren spread over defaultColorPreset — sætter man primary, forbliver
// primaryLight/focus/focusRing STOCK. Så en afledt slot uden override viser
// den resolvede stock-værdi, ærligt mærket. Ægte afledning (primaryLight =
// primary lysnet, focus = primary …) er en core-beslutning (#227-tråden,
// (a)/(b) hos Allan) og kobles på HER når den findes — UI'et ændrer sig ikke.
export interface ColorSlotGroup {
  /** i18n-nøgle under tokens.group.* */
  key: string
  /** Altid synlige felter */
  base: readonly ColorSlot[]
  /** Bag "Vis afledte"-toggle */
  derived: readonly ColorSlot[]
  /** Åben som default (Brand + Baggrund) */
  open?: boolean
}

export const COLOR_SLOT_GROUPS: readonly ColorSlotGroup[] = [
  {
    key: 'brand',
    base: ['primary', 'secondary'],
    derived: ['primaryLight', 'primaryDark', 'onPrimary', 'secondaryLight', 'secondaryDark'],
    open: true,
  },
  {
    key: 'surfaces',
    base: ['background', 'surface'],
    derived: ['backgroundAlt', 'surfaceAlt', 'surfaceRaised', 'surfaceOverlay', 'modalBackdrop'],
    open: true,
  },
  {
    key: 'text',
    base: ['text'],
    derived: ['textSecondary', 'textTertiary', 'textPlaceholder', 'textDisabled', 'textInverse'],
  },
  {
    key: 'borders',
    base: [],
    derived: ['borderLight', 'borderMedium', 'borderStrong', 'borderInverse'],
  },
  {
    key: 'focus',
    base: [],
    derived: ['focus', 'focusRing'],
  },
  {
    key: 'status',
    base: ['success', 'warning', 'error', 'info'],
    derived: [
      'successLight',
      'successDark',
      'warningLight',
      'warningDark',
      'errorLight',
      'errorDark',
      'infoLight',
      'infoDark',
    ],
  },
  {
    key: 'neutral',
    base: [],
    derived: ['neutral'],
  },
] as const

/** Kontrast-par vist INLINE ved base-feltet (designer-regel 4). fg/bg = slots. */
export const INLINE_CONTRAST: Partial<
  Record<ColorSlot, { fg: ColorSlot; bg: ColorSlot; labelKey: string }>
> = {
  primary: { fg: 'onPrimary', bg: 'primary', labelKey: 'onPrimaryOnPrimary' },
  secondary: { fg: 'text', bg: 'secondary', labelKey: 'textOnSecondary' },
  text: { fg: 'text', bg: 'background', labelKey: 'textOnBackground' },
  surface: { fg: 'text', bg: 'surface', labelKey: 'textOnSurface' },
}
