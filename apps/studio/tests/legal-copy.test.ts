import { describe, expect, it } from 'vitest'
import da from '../i18n/locales/da.json'
import en from '../i18n/locales/en.json'

// Juridiske invarianter i kunde-vendt copy. Disse strenge er [jura]-forfattede
// (docs/legal/checkout-forbrugerkrav.md §5a/§5b) og har substans der IKKE må
// gå tabt i en senere omskrivning "for læsbarhed" — derfor pinnes de her og
// ikke kun i en kode-kommentar. Skal teksten ændres, skal juras dokument
// ændres først, og så opdateres denne test bevidst.

describe('font-licens-erklæringen (jura §5a)', () => {
  // 🔴 Kernen: "ret til at bruge" ALENE er præcis hvad en desktop-licens
  // giver. Det er ANDET led — at lade os distribuere til slutbrugerne — der
  // bærer erklæringen. Slås leddene sammen eller forkortes, er erklæringen
  // juridisk værdiløs, og kunden kan svare sandfærdigt ja og stadig være i
  // licensbrud i det øjeblik vi serverer filen.
  it('keeps BOTH limbs: right to use AND right to let us distribute', () => {
    expect(da.brandAssets.license).toContain('ret til at bruge')
    expect(da.brandAssets.license).toContain('lade Grundtone distribuere')
    expect(en.brandAssets.license).toContain('right to use')
    expect(en.brandAssets.license).toContain('let Grundtone distribute')
  })

  it('names the end users the typeface is distributed TO', () => {
    expect(da.brandAssets.license).toMatch(/brugere|besøger/)
    expect(en.brandAssets.license).toMatch(/users|visit/)
  })

  // Formkrav (jura): hjælpeteksten skal bo UDEN FOR afkrydsningsteksten — en
  // for lang label bliver ikke læst, og så er erklæringen mindre værd. Testen
  // fanger en fremtidig sammenlægning ved at kræve at de er to nøgler, og at
  // erklæringen forbliver kort.
  it('keeps guidance out of the checkbox label', () => {
    expect(da.brandAssets.licenseHelp).toBeTruthy()
    expect(da.brandAssets.license).not.toContain('webfont')
    expect(en.brandAssets.license).not.toContain('webfont')
    expect(da.brandAssets.license.length).toBeLessThan(200)
    expect(en.brandAssets.license.length).toBeLessThan(200)
  })

  it('gives customers the licence terms to look for', () => {
    for (const help of [da.brandAssets.licenseHelp, en.brandAssets.licenseHelp]) {
      expect(help).toContain('webfont')
      expect(help).toContain('web embedding')
      expect(help).toContain('web use')
    }
  })
})

describe('font-licens-afsnittet på /legal (jura §5b)', () => {
  it('states plainly that we deliver uploaded typefaces onward', () => {
    expect(da.legalIndex.fontLicensesUpload).toContain('leverer vi den videre')
    expect(en.legalIndex.fontLicensesUpload).toContain('we deliver it onward')
  })

  it('keeps the warranty sentence with both limbs', () => {
    expect(da.legalIndex.fontLicensesWarranty).toContain('lade os distribuere')
    expect(en.legalIndex.fontLicensesWarranty).toContain('let us distribute')
  })

  // OFL-påstanden er verificeret mod alle seks @fontsource-pakkers license-felt
  // (alle OFL-1.1, 2026-08-04) — se server/lib/curated-fonts.ts. Tilføjes en
  // familie under anden licens, skal denne sætning omformuleres.
  it('claims OFL only for the library, never for uploads', () => {
    expect(da.legalIndex.fontLicensesLibrary).toContain('SIL Open Font License')
    expect(da.legalIndex.fontLicensesUpload).not.toContain('SIL Open Font License')
  })
})
