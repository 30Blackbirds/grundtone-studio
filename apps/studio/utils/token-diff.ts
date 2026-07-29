// Token-level diff between two versions (UX-audit finding #9: the version
// history couldn't show WHAT changed between v2→v3). Pure and client-safe —
// VersionHistory renders the result, and the unit test pins the semantics.

export interface TokenChange {
  /** Dotted token path, e.g. `colors.primary` or `dark.colors.background`. */
  path: string
  kind: 'added' | 'removed' | 'changed'
  from?: string
  to?: string
}

type TokenTree = Record<string, unknown>

function flatten(tree: TokenTree, prefix = '', out: Map<string, string> = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    if (value === undefined || value === null) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object') {
      flatten(value as TokenTree, path, out)
    } else {
      out.set(path, String(value))
    }
  }
  return out
}

export function diffTokens(from: TokenTree, to: TokenTree): TokenChange[] {
  const a = flatten(from)
  const b = flatten(to)
  const changes: TokenChange[] = []

  for (const [path, value] of b) {
    const prev = a.get(path)
    if (prev === undefined) changes.push({ path, kind: 'added', to: value })
    else if (prev !== value) changes.push({ path, kind: 'changed', from: prev, to: value })
  }
  for (const [path, value] of a) {
    if (!b.has(path)) changes.push({ path, kind: 'removed', from: value })
  }

  return changes.sort((x, y) => x.path.localeCompare(y.path))
}

/** Color paths get swatches in the UI; everything else renders as text. */
export function isColorPath(path: string): boolean {
  return path === 'colors' || path.startsWith('colors.') || path.startsWith('dark.colors.')
}
