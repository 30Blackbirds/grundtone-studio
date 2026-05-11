// Inlined from @grundtone/vue (~30 LOC) so this SDK stays small enough to ship
// as a CDN script-tag bundle without pulling in the full @grundtone/vue
// component library or its Vue peerDep.

interface ShadowLayer {
  x: number
  y: number
  blur: number
  spread: number
  color: string
  inset?: boolean
}

type FlatTheme = {
  mode: 'light' | 'dark'
  colors: Record<string, string>
  spacing: Record<string, string>
  typography: {
    fontFamily: Record<string, string>
    fontSize: Record<string, string>
    fontWeight: Record<string, number>
    lineHeight: Record<string, number>
  }
  radius: Record<string, string>
  shadowDefinitions: Record<string, ShadowLayer[]>
  zIndex: Record<string, number>
  transitions: {
    duration: Record<string, string>
    timing: Record<string, string>
  }
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function shadowLayersToCSS(layers: ShadowLayer[]): string {
  return layers
    .map((l) => `${l.inset ? 'inset ' : ''}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${l.color}`)
    .join(', ')
}

export function applyThemeToDOM(theme: FlatTheme, el?: HTMLElement): void {
  if (typeof document === 'undefined') return
  const root = el ?? document.documentElement
  root.style.setProperty('color-scheme', theme.mode === 'dark' ? 'dark' : 'light')
  for (const [k, v] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${camelToKebab(k)}`, v)
  }
  for (const [k, v] of Object.entries(theme.spacing)) {
    root.style.setProperty(`--space-${k}`, v)
  }
  for (const [k, v] of Object.entries(theme.typography.fontFamily)) {
    root.style.setProperty(`--font-family-${k}`, v)
  }
  for (const [k, v] of Object.entries(theme.typography.fontSize)) {
    root.style.setProperty(`--font-size-${k}`, v)
  }
  for (const [k, v] of Object.entries(theme.typography.fontWeight)) {
    root.style.setProperty(`--font-weight-${k}`, String(v))
  }
  for (const [k, v] of Object.entries(theme.typography.lineHeight)) {
    root.style.setProperty(`--line-height-${k}`, String(v))
  }
  for (const [k, v] of Object.entries(theme.radius)) {
    root.style.setProperty(`--radius-${k}`, v)
  }
  for (const [k, layers] of Object.entries(theme.shadowDefinitions)) {
    root.style.setProperty(`--shadow-${k}`, shadowLayersToCSS(layers))
  }
  root.style.setProperty('--shadow-none', 'none')
  for (const [k, v] of Object.entries(theme.zIndex)) {
    root.style.setProperty(`--z-${camelToKebab(k)}`, String(v))
  }
  for (const [k, v] of Object.entries(theme.transitions.duration)) {
    root.style.setProperty(`--duration-${k}`, v)
  }
  for (const [k, v] of Object.entries(theme.transitions.timing)) {
    root.style.setProperty(`--${camelToKebab(k)}`, v)
  }
}
