import { describe, it, expect } from 'vitest'
import { isCssColor } from './css-values'

// Publish-gaten er tokensSchema (server/lib/tokens.ts) — bevis afvisningen på
// NIVEAUET der beskytter CDN'en, ikke kun i hjælperen.
import { tokensSchema } from '../server/lib/tokens'

describe('isCssColor — hex-længder', () => {
  // Produkt-fundet 2026-08-18: det AKTIVE etude-sæt bar `#00000` (5 cifre).
  // Browseren dropper deklarationen tavst, så publish-gaten er sidste værn.
  it('afviser 5-cifret hex — værdien der lå live på CDN', () => {
    expect(isCssColor('#00000')).toBe(false)
  })

  it('afviser 7-cifret hex (naboklassen til samme hul)', () => {
    expect(isCssColor('#1234567')).toBe(false)
  })

  it('accepterer de fire gyldige hex-længder: 3, 4, 6, 8', () => {
    expect(isCssColor('#fff')).toBe(true)
    expect(isCssColor('#fffa')).toBe(true)
    expect(isCssColor('#0059b3')).toBe(true)
    expect(isCssColor('#0059b3cc')).toBe(true)
  })

  it('afviser hex med ikke-hex-cifre', () => {
    expect(isCssColor('#00zz00')).toBe(false)
  })

  it('accepterer fortsat øvrige farveformer uændret', () => {
    expect(isCssColor('rgb(0, 89, 179)')).toBe(true)
    expect(isCssColor('rgba(0, 89, 179, 0.5)')).toBe(true)
    expect(isCssColor('hsl(210 100% 35%)')).toBe(true)
    expect(isCssColor('rebeccapurple')).toBe(true)
    expect(isCssColor('var(--gt-color-primary)')).toBe(true)
  })
})

describe('tokensSchema — farve-validering ved publish-gaten', () => {
  it('afviser præcis den publicerede defekt-form med en handlingsbar fejl', () => {
    const r = tokensSchema.safeParse({ colors: { primaryDark: '#00000' } })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join('.') === 'colors.primaryDark')
      expect(issue?.message).toContain('3, 4, 6 or 8')
    }
  })

  it('accepterer spec-værdierne fra Beslutning F', () => {
    const r = tokensSchema.safeParse({
      colors: { primary: '#0059b3', primaryDark: '#003a7a', onPrimary: '#ffffff' },
    })
    expect(r.success).toBe(true)
  })
})
