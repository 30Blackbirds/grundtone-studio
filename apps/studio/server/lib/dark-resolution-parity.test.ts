import { describe, it, expect } from 'vitest'
import { createTheme } from '@grundtone/core'
import { renderTokensCss } from './css-renderer'

// [designer]s spørgsmål på #228: viser editorens "auto" for en USAT dark-slot
// præcis det tal konsumenten får? To konsument-veje findes, og de skal begge
// holdes op mod editorens resolution — "to sandheder der ser ens ud indtil de
// ikke gør" er den klasse denne test er værn mod.
//
// Editor (TokenEditor.vue `resolved`, dark-mode):
//   createTheme({ light, dark: { ...light, ...darkOverrides } }).dark.colors
// SDK (packages/saas-client/src/index.ts): SAMME konstruktion.
// tokens.css: :root = light, dark-blok = KUN overrides → usat dark-slot falder
//   til :root's light-værdi (hvis sat i light) ellers design-systemets egen
//   dark-default — den når ALDRIG core's dark-stock via Studio.
const light = { primary: '#d63a54', background: '#ffffff', text: '#1b1a2e' }
const darkOverrides = { primary: '#ef6479' }
const tokens = { colors: light, dark: { colors: darkOverrides } }

type Colors = Record<string, string>
const asColors = (c: unknown) => c as Colors

function editorResolvedDark(): Colors {
  return asColors(createTheme({ light, dark: { ...light, ...darkOverrides } }).dark.colors)
}
function sdkResolvedDark(): Colors {
  // ordret efter saas-client/src/index.ts
  const { dark, ...base } = tokens
  const darkTokens =
    dark?.colors && Object.keys(dark.colors).length > 0
      ? { ...base, colors: { ...base.colors, ...dark.colors } }
      : base
  return asColors(createTheme({ light: base.colors, dark: darkTokens.colors }).dark.colors)
}

describe('dark resolution: editor "auto" == consumer', () => {
  it('editor == SDK for every slot (same construction, asserted not assumed)', () => {
    expect(editorResolvedDark()).toEqual(sdkResolvedDark())
  })

  it('documents the override-model trap: a slot set in light but NOT in dark inherits the LIGHT value in dark', () => {
    // background=#ffffff sat i light, usat i dark → dark.background er HVID.
    // Det er hvad editoren viser som "auto" og hvad SDK/CSS leverer — sandt
    // og konsistent, men et dark-tema med hvid baggrund. Override-modellen
    // (2026-07-29) lægger ansvaret på tenanten for at sætte dark eksplicit.
    expect(editorResolvedDark().background).toBe('#ffffff')
  })

  it('tokens.css dark block carries overrides only — never core dark-stock for unset slots', () => {
    const css = renderTokensCss(tokens as Parameters<typeof renderTokensCss>[0])
    const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    expect(darkBlock).toContain('--color-primary: #ef6479;')
    expect(darkBlock).not.toMatch(/--color-background:/)
    expect(darkBlock).not.toMatch(/--color-surface-alt:/)
    // Konsekvens: for en slot USAT i både light og dark (fx surfaceAlt) viser
    // editoren core's dark-stock (#252525) mens en <link>-konsument får
    // design-systemets dark-default — de er i dag identiske tal fordi begge
    // stammer fra samme preset, men kæden er IKKE den samme.
    expect(editorResolvedDark().surfaceAlt).toBe('#252525')
  })
})
