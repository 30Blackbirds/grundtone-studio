// Optional surfaces a layer adds to Studio, reported by GET /api/features so
// the UI hides what this deployment does not have. A layer registers its
// feature from a Nitro plugin; an unregistered feature is off.

export type FeatureName = 'billing'

const registry = new Map<FeatureName, () => boolean>()

/** Registers whether a feature is on; `enabled` is asked on every read. */
export function registerFeature(name: FeatureName, enabled: () => boolean): void {
  registry.set(name, enabled)
}

export function featureEnabled(name: FeatureName): boolean {
  return registry.get(name)?.() ?? false
}

/** Test seam: forget every registration. */
export function resetFeatures(): void {
  registry.clear()
}
