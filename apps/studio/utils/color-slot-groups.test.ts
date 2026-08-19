import { describe, it, expect } from 'vitest'
import { COLOR_SLOTS } from '~~/server/lib/tokens'
import { COLOR_SLOT_GROUPS } from './color-slot-groups'

// Grupperingen og schemaet skal dække PRÆCIS samme slot-sæt — ellers findes
// der slots man kan publicere men ikke se, eller felter for slots der ikke
// validerer. Bundet til COLOR_SLOTS, som selv er bundet til core (parity-test).
describe('COLOR_SLOT_GROUPS', () => {
  const grouped = COLOR_SLOT_GROUPS.flatMap((g) => [...g.base, ...g.derived])

  it('covers every schema slot exactly once', () => {
    const missing = COLOR_SLOTS.filter((s) => !grouped.includes(s))
    const dupes = grouped.filter((s, i) => grouped.indexOf(s) !== i)
    const unknown = grouped.filter((s) => !(COLOR_SLOTS as readonly string[]).includes(s))
    expect({ missing, dupes, unknown }).toEqual({ missing: [], dupes: [], unknown: [] })
  })

  it('has 9 base fields per mode (designer spec) and the rest derived', () => {
    const base = COLOR_SLOT_GROUPS.flatMap((g) => g.base)
    expect(base).toHaveLength(9)
    expect(grouped.length - base.length).toBe(COLOR_SLOTS.length - 9)
  })

  it('opens Brand + Surfaces by default, nothing else', () => {
    expect(COLOR_SLOT_GROUPS.filter((g) => g.open).map((g) => g.key)).toEqual(['brand', 'surfaces'])
  })
})
