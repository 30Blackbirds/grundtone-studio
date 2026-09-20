import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 🔴 WHAT THIS CELL CAN AND CANNOT DO — read this before trusting its green.
//
// KH-1124's acceptance asks for "a cell that fails on horizontal overflow".
// THAT CELL CANNOT BE WRITTEN HERE. Vitest runs in happy-dom, which does no
// layout: every width it reports is 0, so a test asserting "nothing overflows"
// would pass on a page that is entirely broken — the exact silent green that
// closed studio#298 while a clip was still on screen. Studio has no browser
// runner, so the layout acceptance lives in the commit as a measurement, not
// here as an assertion.
//
// What this DOES pin is the RULE that cures it, and it pins it as TEXT. It
// cannot see whether the rule takes effect; it can see that nobody has quietly
// gone back to a fixed column count, which is how the defect was written in
// the first place.

const css = () => readFileSync(new URL('../assets/css/app.css', import.meta.url), 'utf8')
const editor = () => readFileSync(new URL('../components/TokenEditor.vue', import.meta.url), 'utf8')

describe('the token grids follow their container', () => {
  it('uses auto-fill, not auto-fit', () => {
    // auto-fit COLLAPSES empty tracks, so a group holding one field stretches
    // it to the full width — measured at 1440 as `496px 0px`, a desktop change
    // nobody asked for. The two behave identically when the grid is full,
    // which is why measuring only 375 would have shipped it.
    const rule = css().match(/\.token-grid\s*\{[^}]*\}/)?.[0]
    expect(rule, '.token-grid is gone from app.css').toBeTruthy()
    expect(rule).toMatch(/repeat\(\s*auto-fill\s*,/)
    expect(rule, 'auto-fit collapses empty tracks — see the comment above the rule').not.toMatch(
      /auto-fit/,
    )
  })

  it('keeps a floor wide enough for a contrast chip', () => {
    // The chip is swatch 40px + 12px gap + a badge that cannot shrink
    // (white-space: nowrap, min-width: auto in the library). Below this floor
    // the cell gets narrower than the badge and the badge is clipped — the
    // defect [designer] found at 375, where the cell was 125.5px.
    const floor = css().match(/\.token-grid\s*\{[^}]*minmax\(\s*([\d.]+)rem/)?.[1]
    expect(floor, 'no minmax floor found on .token-grid').toBeTruthy()
    expect(Number(floor)).toBeGreaterThanOrEqual(12)
  })

  it('no fixed two-column grid came back where the contrast chips live', () => {
    // The original defect, verbatim: `grid grid-cols-2` gives 125.5px cells
    // inside the accordion at 375 whatever the content needs.
    //
    // 🔴 SCOPED TO `grid-cols-2` ON PURPOSE. TokenEditor also has a
    // `grid-cols-4` (radius) and a `grid-cols-3` (spacing), and they are NOT
    // part of this defect: they hold plain GTInputs, no contrast chip, and
    // both measured clean at 375 (docOverflow 0, 0 clipped elements). A guard
    // that forbade every fixed column count would be demanding changes this
    // measurement never asked for.
    const src = editor()
    expect(
      src.includes('grid-cols-2'),
      'TokenEditor.vue uses grid-cols-2 again — the contrast chips need .token-grid, ' +
        'whose columns follow the container',
    ).toBe(false)
    expect(
      (src.match(/token-grid/g) ?? []).length,
      'the grids that hold contrast chips no longer use .token-grid',
    ).toBeGreaterThanOrEqual(4)
  })

  it('the contrast badge may wrap', () => {
    // A label is a sentence in some locales: "AA (large only)" is 118px,
    // "AA (kun store skrifttyper)" is 181px. A nowrap badge turns that
    // difference into clipped pixels instead of a second line.
    const sfc = readFileSync(new URL('../components/ContrastBadge.vue', import.meta.url), 'utf8')
    const scoped = sfc.slice(sfc.indexOf('<style'))
    expect(scoped).toMatch(/:deep\(\.gt-badge\)\s*\{[^}]*white-space:\s*normal/)
  })
})
