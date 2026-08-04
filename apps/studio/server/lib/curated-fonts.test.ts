import { describe, expect, it } from 'vitest'
import { CURATED_FONTS, FONT_WEIGHTS } from './tokens'
import { curatedFontFiles, isCuratedFamily, readCuratedFont } from './curated-fonts'

describe('curated fonts (self-host via @fontsource)', () => {
  it('every curated family × weight resolves to real woff2 bytes on disk', async () => {
    // Pinner at ALLE kombinationer i det låste v1-katalog faktisk findes i de
    // installerede pakker — en manglende fil skal fejle her, ikke i et publish.
    for (const family of CURATED_FONTS) {
      for (const weight of FONT_WEIGHTS) {
        const buf = await readCuratedFont(family, weight)
        expect(buf.subarray(0, 4).toString('ascii'), `${family} ${weight}`).toBe('wOF2')
      }
    }
  })

  it('rejects non-curated families loudly', async () => {
    await expect(readCuratedFont('Comic Sans MS', 400)).rejects.toThrow('Not a curated family')
    expect(isCuratedFamily('Inter')).toBe(true)
    expect(isCuratedFamily('Comic Sans MS')).toBe(false)
  })

  it('derives schema-valid reference names with the shared slug rule', () => {
    expect(curatedFontFiles('IBM Plex Sans', [400, 700])).toEqual([
      { name: 'fonts/ibm-plex-sans-400.woff2', weight: 400 },
      { name: 'fonts/ibm-plex-sans-700.woff2', weight: 700 },
    ])
  })
})
