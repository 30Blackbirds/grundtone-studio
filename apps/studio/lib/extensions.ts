// Registries a Nuxt layer extends through app.config (Nuxt merges app.config
// across layers, concatenating arrays). Studio registers its own entries in
// apps/studio/app.config.ts; a layer that adds a surface (the hosted service's
// billing, for one) adds its entries in its own app.config.ts, without editing
// a Studio file.

export interface OrgNavItem {
  /** Unique key. A later entry with the same id replaces an earlier one. */
  id: string
  /** Page under `/orgs/<slug>/`, e.g. `billing`. */
  path: string
  /** i18n key of the link text. */
  labelKey: string
  /**
   * Who sees the link: `billing` = may manage billing (owner, billing role);
   * `orgAdmin` = may manage members. The page enforces its own gate; this
   * only hides a link the caller could not use.
   */
  gate: 'billing' | 'orgAdmin'
  /** Shown only when GET /api/features reports this optional feature on. */
  feature?: 'billing'
}

export interface StudioExtensions {
  /** Extra org-administration links, shown after Members in the sidebar. */
  orgNav: OrgNavItem[]
  /**
   * Keys of the data processors listed on /privacy and /sub-processors. Each
   * key needs `processors.rows.<key>.{name,service,established,location,
   * transfer}` in every locale.
   */
  legalProcessors: string[]
  /**
   * Where a quota alert sends someone to raise the limit (gets `?org=<slug>`).
   * Empty: the alert shows no upgrade button, as on a self-hosted install.
   */
  upgradePath: string
}

export interface OrgNavContext {
  canManageBilling: boolean
  canManageOrgMembers: boolean
  features: { billing: boolean }
}

export function visibleOrgNavItems(items: readonly OrgNavItem[], ctx: OrgNavContext): OrgNavItem[] {
  return lastById(items).filter((item) => {
    const allowed = item.gate === 'billing' ? ctx.canManageBilling : ctx.canManageOrgMembers
    const featureOn = item.feature === undefined || ctx.features[item.feature]
    return allowed && featureOn
  })
}

export function legalProcessorKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)]
}

function lastById<T extends { id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of items) {
    byId.delete(item.id)
    byId.set(item.id, item)
  }
  return [...byId.values()]
}
