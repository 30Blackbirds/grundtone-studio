import type { Entitlements, EntitlementsProvider } from './entitlements'

/** `planKey` the self-host provider reports; no plan catalog entry exists for it. */
export const SELF_HOST_PLAN_KEY = 'self-host'

function limitFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`)
  }
  return n
}

/**
 * Default provider for a deployment with no payment provider: limits come
 * from the environment, and an unset limit means unlimited.
 *
 *   STUDIO_LIMIT_BRANDS    max active brands per organization
 *   STUDIO_LIMIT_PROJECTS  max projects per organization
 *
 * With neither set it answers `null`, which every quota gate already reads as
 * "allowed" and the provisioning feature allows when billing is off.
 */
export const selfHostProvider: EntitlementsProvider = {
  async get() {
    const limits: Record<string, number> = {}
    const brands = limitFromEnv('STUDIO_LIMIT_BRANDS')
    const projects = limitFromEnv('STUDIO_LIMIT_PROJECTS')
    if (brands !== undefined) limits['studio.brands'] = brands
    if (projects !== undefined) limits['studio.projects'] = projects
    if (Object.keys(limits).length === 0) return null
    const entitlements: Entitlements = {
      planKey: SELF_HOST_PLAN_KEY,
      planState: 'active',
      graceUntil: null,
      features: [],
      limits,
      asOf: new Date().toISOString(),
    }
    return entitlements
  },
}
