import { type Entitlements, type EntitlementsProvider, PROVISIONING_FEATURE } from './entitlements'

/** `planKey` the self-host provider reports. */
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
 * Default provider for a deployment with no payment provider (D-E2, Allan
 * 2026-11-10): no plan, every feature, and limits only from the environment.
 * An unset limit means unlimited.
 *
 *   STUDIO_LIMIT_BRANDS    max active brands per organization (a hard cap)
 *   STUDIO_LIMIT_PROJECTS  max projects per organization
 *
 * It always answers, so a self-host install is never refused for lack of an
 * answer, and the fail-closed provisioning feature passes.
 */
export const selfHostProvider: EntitlementsProvider = {
  async get() {
    const limits: Record<string, number> = {}
    const brands = limitFromEnv('STUDIO_LIMIT_BRANDS')
    const projects = limitFromEnv('STUDIO_LIMIT_PROJECTS')
    if (brands !== undefined) limits['studio.brands'] = brands
    if (projects !== undefined) limits['studio.projects'] = projects
    const entitlements: Entitlements = {
      planKey: SELF_HOST_PLAN_KEY,
      planState: 'active',
      graceUntil: null,
      features: [PROVISIONING_FEATURE],
      limits,
      asOf: new Date().toISOString(),
    }
    return entitlements
  },
  brandLimitIsHardCap: () => true,
}
