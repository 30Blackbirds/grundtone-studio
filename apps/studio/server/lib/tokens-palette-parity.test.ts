import { describe, it, expect } from 'vitest'
import { createTheme } from '@grundtone/core'
import { tokensSchema, COLOR_SLOTS } from './tokens'

// Studio er tema-KILDEN for konsumenter der kører @grundtone/core's createTheme.
// Udtrykker Studio færre farveslots end core resolver, kan en tenant aldrig
// sætte dem — og de arver tavst stock (fx blå fokus-ring under røde knapper,
// Allan-direktiv 2026-08-19, #227). Denne test binder Studios slot-sæt til den
// installerede core-versions RUNTIME-palette, så drift fanges ved core-bump.
const coreKeys = Object.keys(createTheme({}).light.colors).sort()
const studioKeys: readonly string[] = COLOR_SLOTS

describe('Studio colour slots == @grundtone/core palette', () => {
  it('exposes every colour key core resolves (no silent stock inheritance)', () => {
    const missing = coreKeys.filter((k) => !studioKeys.includes(k))
    expect(missing, `Studio mangler core-slots: ${missing.join(', ')}`).toEqual([])
  })

  it('exposes no key core does not know (renderer would emit a dead --color-*)', () => {
    const extra = studioKeys.filter((k) => !coreKeys.includes(k))
    expect(extra).toEqual([])
  })

  it('accepts a full core palette in both light and dark', () => {
    const t = createTheme({})
    const r = tokensSchema.safeParse({ colors: t.light.colors, dark: { colors: t.dark.colors } })
    if (!r.success) console.error(r.error.issues.slice(0, 5))
    expect(r.success).toBe(true)
  })
})
