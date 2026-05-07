// @grundtone/saas-client — runtime SDK
//
// Fetches tokens from the Studio CDN keyed by API key, then applies them via
// @grundtone/core's applyThemeToDOM. Implementation lands in Fase 4.

export const VERSION = '0.0.0'

export interface SaasClientOptions {
  apiKey: string
  cdnBase?: string
}

export async function loadByApiKey(_options: SaasClientOptions): Promise<void> {
  throw new Error('Not implemented yet — see ROADMAP.md Fase 4')
}
