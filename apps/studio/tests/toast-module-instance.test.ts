import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// @grundtone/nuxt registers GTToastContainer from @grundtone/vue/src and
// auto-imports useToast from src/composables. An explicit
// `import { useToast } from '@grundtone/vue'` resolves to dist/ instead, a
// SECOND reactive toast state the container never reads, so the toast silently
// never renders (measured 2026-09-17: 8 files, invite sent with 0 toast
// elements). Use the auto-import. useToast is the only composable in the
// package with module-level state.

const root = join(__dirname, '..')
const STATEFUL = ['useToast', 'toastState']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(vue|ts)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

// Every `import … from '@grundtone/vue'` statement, including multi-line ones.
const IMPORT_FROM_VUE_PACKAGE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@grundtone\/vue['"]/g

export function statefulImports(source: string): string[] {
  const names: string[] = []
  for (const m of source.matchAll(IMPORT_FROM_VUE_PACKAGE)) {
    for (const spec of m[1]!.split(',')) {
      const name = spec
        .trim()
        .split(/\s+as\s+/)[0]!
        .replace(/^type\s+/, '')
      if (STATEFUL.includes(name)) names.push(name)
    }
  }
  return names
}

describe('toast state has one module instance', () => {
  const files = ['pages', 'components', 'composables', 'layouts', 'plugins', 'middleware']
    .map((d) => join(root, d))
    .filter((d) => {
      try {
        return statSync(d).isDirectory()
      } catch {
        return false
      }
    })
    .flatMap(sourceFiles)

  it('scans the app sources (denominator is not zero)', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('the detector sees single-line, multi-line and aliased imports (control)', () => {
    expect(statefulImports(`import { useToast } from '@grundtone/vue'`)).toEqual(['useToast'])
    expect(
      statefulImports(`import {\n  GTButton,\n  toastState,\n} from "@grundtone/vue"`),
    ).toEqual(['toastState'])
    expect(statefulImports(`import { useToast as toast } from '@grundtone/vue'`)).toEqual([
      'useToast',
    ])
    expect(statefulImports(`import { applyThemeToDOM } from '@grundtone/vue'`)).toEqual([])
  })

  it('no app file imports useToast or toastState from the package entry', () => {
    const offenders = files
      .map((f) => ({ file: relative(root, f), names: statefulImports(readFileSync(f, 'utf8')) }))
      .filter((o) => o.names.length)
    expect(offenders).toEqual([])
  })
})
