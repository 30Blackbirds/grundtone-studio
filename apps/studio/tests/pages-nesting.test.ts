import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Nuxt turns `pages/foo.vue` next to a `pages/foo/` directory into a PARENT
// route: every page inside `foo/` renders inside foo.vue's <NuxtPage />. Without
// that outlet the child pages are unreachable. The URL changes, but the parent
// keeps rendering. That is how pages/orgs/[slug]/members/[memberId].vue (the
// role editor) could not be opened from 2026-05-13 until this guard.
// A list page belongs in `foo/index.vue` instead.

const pagesDir = join(__dirname, '..', 'pages')

function parentPagesWithoutOutlet(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      const parent = `${full}.vue`
      if (existsSync(parent) && !/<NuxtPage\b/.test(readFileSync(parent, 'utf8'))) {
        found.push(parent.slice(pagesDir.length + 1))
      }
      found.push(...parentPagesWithoutOutlet(full))
    }
  }
  return found
}

describe('pages/ nesting', () => {
  it('scans real page directories (denominator is not zero)', () => {
    const dirs = readdirSync(join(pagesDir, 'orgs', '[slug]'))
    expect(dirs.length).toBeGreaterThan(0)
  })

  it('no page file sits next to a same-named directory without rendering <NuxtPage />', () => {
    expect(parentPagesWithoutOutlet(pagesDir)).toEqual([])
  })
})
