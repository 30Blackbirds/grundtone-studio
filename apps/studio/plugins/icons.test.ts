import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { iconRegistry } from '@grundtone/icons'

// Riff KH-1114. Studio never provided the icon registry, so `<GTIcon name="…">`
// resolved nothing. It was not merely a console warning: measured on the served
// main build, the password reveal toggle on /login rendered
// `<button class="gt-password-input__toggle"><!----></button>` — a 17px-wide
// button with no glyph, whose only affordance was a Danish aria-label. With the
// plugin it renders a 24x24 svg and the button is 33px wide.

const appRoot = join(__dirname, '..')

const templates = () => {
  const files: string[] = []
  // withFileTypes, not statSync-then-read: one call answers both questions and
  // there is no window in which the entry can change between them.
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (full.endsWith('.vue')) files.push(full)
    }
  }
  for (const dir of ['pages', 'components', 'layouts']) walk(join(appRoot, dir))
  return files
}

describe('the icon registry studio provides', () => {
  it('is not empty, which is the shape a renamed or tree-shaken export would take', () => {
    // 10 and not 27: 27 is what it holds today, 10 is the smallest count still
    // certainly true. A floor exists to catch a broken import, not to freeze
    // the icon set.
    expect(Object.keys(iconRegistry).length).toBeGreaterThan(10)
  })

  // 🔴 THE CELL THAT WOULD HAVE CAUGHT `info`. Measured 2026-09-20: studio asked
  // for `name="info"` in two places, and the registry only has `info-circle` —
  // so those two icons would have stayed blank even after the registry was
  // provided. A name that does not resolve draws nothing and says nothing.
  it('resolves every icon name studio actually asks for', () => {
    const used = new Map<string, string>()
    for (const file of templates()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/<GTIcon[^>]*\sname="([^"]+)"/g)) {
        used.set(m[1]!, file.slice(appRoot.length + 1))
      }
    }

    // The denominator, stated rather than assumed: a walker that found nothing
    // would otherwise pass this cell by measuring an empty set.
    expect(
      used.size,
      'no <GTIcon name="…"> found at all — the sweep is broken',
    ).toBeGreaterThanOrEqual(3)

    expect([...used].filter(([name]) => !(name in iconRegistry))).toEqual([])
  })

  // 🔴 SEPARATE CELL BECAUSE THE NAMES COME FROM THE LIBRARY, NOT FROM US.
  // PasswordInput asks for these itself, so no studio file mentions them and
  // the sweep above cannot see them. They can disappear under a library upgrade
  // without a single line changing here — and the symptom is the empty button
  // measured above, which no test of ours would otherwise notice.
  it('holds the icons the library asks for on the login page', () => {
    expect(Object.keys(iconRegistry)).toEqual(expect.arrayContaining(['eye', 'eye-off']))
  })

  // The plugin itself cannot be exercised without a Nuxt runtime, so this reads
  // the file. It is a weak instrument and is here for one strong reason: it
  // fails if someone deletes the provide, which is the exact regression.
  it('is actually provided to the app', () => {
    const plugin = readFileSync(join(appRoot, 'plugins', 'icons.ts'), 'utf8')
    expect(plugin).toContain('GT_ICON_REGISTRY_KEY')
    expect(plugin).toMatch(/provide\(\s*GT_ICON_REGISTRY_KEY\s*,\s*iconRegistry\s*\)/)
  })
})
