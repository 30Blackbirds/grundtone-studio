// @grundtone/saas-client
//
// Runtime SDK for Grundtone Studio. Fetches a project's published tokens from
// the Studio CDN keyed by API key, then applies them via CSS custom
// properties on :root.
//
// Three usage patterns are supported:
//
//   import { loadByApiKey, grundtone } from '@grundtone/saas-client'
//   await loadByApiKey({ apiKey: 'pk_live_...' })
//
//   import { grundtone } from '@grundtone/saas-client'
//   app.use(grundtone, { apiKey: 'pk_live_...' })
//
//   <script src="https://cdn.grundtone.io/client/v1.js"
//           data-api-key="pk_live_..."></script>

import { createTheme } from '@grundtone/core'
import { applyThemeToDOM } from './applyThemeToDOM'

export interface GrundtoneOptions {
  apiKey: string
  /** Override the CDN base (e.g. for self-hosted Studio). Default: https://cdn.grundtone.io */
  cdnBase?: string
  /** 'light' (default), 'dark', or 'auto' to follow prefers-color-scheme. */
  mode?: 'light' | 'dark' | 'auto'
  /** Element to scope CSS variables on. Defaults to document.documentElement. */
  target?: HTMLElement
  /** Called with the fetched tokens on success — useful for app-side logging. */
  onLoad?: (tokens: unknown) => void
  /** Called when fetch or apply fails. Default: console.warn. */
  onError?: (err: unknown) => void
}

const DEFAULT_CDN = 'https://cdn.grundtone.io'
export const VERSION = '0.0.1'

function detectMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface LoadResult {
  tokens: unknown
  mode: 'light' | 'dark'
}

export async function loadByApiKey(options: GrundtoneOptions): Promise<LoadResult> {
  if (!options.apiKey) throw new Error('apiKey is required')
  const base = (options.cdnBase ?? DEFAULT_CDN).replace(/\/$/, '')
  const url = `${base}/k/${encodeURIComponent(options.apiKey)}/tokens.json`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'default',
  })
  if (!res.ok) {
    throw new Error(`Failed to load tokens: ${res.status} ${res.statusText}`)
  }
  const tokens = (await res.json()) as Parameters<typeof createTheme>[0]

  const themes = createTheme({ light: tokens, dark: tokens })
  const requested = options.mode ?? 'light'
  const mode: 'light' | 'dark' = requested === 'auto' ? detectMode() : requested
  const theme = mode === 'dark' ? themes.dark : themes.light

  // Cast: applyThemeToDOM in this package mirrors the structure from
  // @grundtone/vue but is typed locally to avoid a hard dependency.
  applyThemeToDOM(theme as never, options.target)

  options.onLoad?.(tokens)
  return { tokens, mode }
}

/** Vue plugin — `app.use(grundtone, { apiKey })`. Non-blocking; logs on error. */
export const grundtone = {
  install(_app: unknown, options: GrundtoneOptions): void {
    loadByApiKey(options).catch((err) => {
      ;(options.onError ?? console.warn.bind(console, '[grundtone/saas-client]'))(err)
    })
  },
}

// Auto-init when loaded via <script data-api-key="..."> tag.
// Skipped when consumed via ESM-bundler (document.currentScript is null).
declare const __SAAS_CLIENT_AUTO_INIT__: boolean
if (
  typeof document !== 'undefined' &&
  typeof __SAAS_CLIENT_AUTO_INIT__ !== 'undefined' &&
  __SAAS_CLIENT_AUTO_INIT__
) {
  const script = document.currentScript as HTMLScriptElement | null
  const apiKey = script?.dataset.apiKey
  if (apiKey) {
    loadByApiKey({
      apiKey,
      cdnBase: script?.dataset.cdnBase,
      mode: (script?.dataset.mode as 'light' | 'dark' | 'auto' | undefined) ?? 'light',
    }).catch((err) => {
      console.warn('[grundtone/saas-client] auto-init failed', err)
    })
  }
}
