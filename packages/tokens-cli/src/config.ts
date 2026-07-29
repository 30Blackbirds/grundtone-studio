// Pure config resolution + token mutation helpers — kept separate from the CLI
// entry (which does IO) so they can be unit-tested without a network or process.

export interface ResolvedConfig {
  apiBase: string
  key: string
}

export interface ConfigFile {
  apiBase?: string
  /** Per-project secret keys, plus an optional `default` fallback. */
  keys?: Record<string, string>
}

/**
 * Resolve the API base URL and the project's secret key from, in order of
 * precedence: explicit flags → environment → the config file. Per-project keys
 * are least privilege, so a project without its own key falls back to `default`
 * only if one is configured.
 */
export function resolveConfig(input: {
  projectId: string
  flags: { apiBase?: string; key?: string }
  env: Record<string, string | undefined>
  configFile: ConfigFile | null
}): ResolvedConfig {
  const { projectId, flags, env, configFile } = input

  const apiBase = flags.apiBase ?? env.GRUNDTONE_API_BASE ?? configFile?.apiBase
  const key =
    flags.key ??
    env.GRUNDTONE_TOKEN_KEY ??
    configFile?.keys?.[projectId] ??
    configFile?.keys?.default

  if (!apiBase) {
    throw new Error(
      'No API base URL. Set --api-base, GRUNDTONE_API_BASE, or apiBase in ~/.grundtone/config.json',
    )
  }
  if (!key) {
    throw new Error(
      `No secret key for project ${projectId}. Set --key, GRUNDTONE_TOKEN_KEY, or keys["${projectId}"] in ~/.grundtone/config.json`,
    )
  }
  if (!key.startsWith('sk_')) {
    throw new Error('Token key must be a secret key (starts with "sk_"), not a publishable pk_ key')
  }

  return { apiBase: apiBase.replace(/\/+$/, ''), key }
}

type JsonObject = Record<string, unknown>

export interface ConfigResponse {
  draft?: { tokens?: JsonObject } | null
  active?: { tokens?: JsonObject } | null
  defaults?: JsonObject | null
}

/**
 * Pick the token object `set --set` starts from: draft → active → defaults.
 *
 * Two bugs lived here before this helper: (1) the CLI used `config.draft ??
 * config.active` — but those are WRAPPERS ({id, version, tokens}), and the
 * config POST endpoint is zod-strict, so posting a wrapper 400'd with
 * "Unrecognized key: id"; (2) there was no defaults fallback, so a project
 * with no draft started from {} and wiped every unset slot.
 */
export function pickTokensBase(config: ConfigResponse | null | undefined): JsonObject {
  return config?.draft?.tokens ?? config?.active?.tokens ?? config?.defaults ?? {}
}

/**
 * Apply `dot.path=value` assignments onto a clone of the base tokens object,
 * creating intermediate objects as needed. Used by `set --set colors.primary=#...`.
 */
export function applySets(base: JsonObject, sets: string[]): JsonObject {
  const out = structuredClone(base)
  for (const assignment of sets) {
    const eq = assignment.indexOf('=')
    if (eq < 1) {
      throw new Error(`Invalid --set "${assignment}" (expected dot.path=value)`)
    }
    const path = assignment.slice(0, eq).split('.')
    const value = assignment.slice(eq + 1)

    let node: JsonObject = out
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i]!
      const next = node[seg]
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        node[seg] = {}
      }
      node = node[seg] as JsonObject
    }
    node[path[path.length - 1]!] = value
  }
  return out
}
