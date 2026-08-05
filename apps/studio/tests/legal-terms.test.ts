import { describe, it, expect } from 'vitest'
import da from '~~/i18n/locales/da.json'
import en from '~~/i18n/locales/en.json'

// Vilkårsteksten har RETSVIRKNING. Den er udledt af juras kilde
// (docs/legal/studio-abonnementsvilkår.md, studio-tos-1.0) frem for skrevet
// af, saa den kan ikke drive fra kilden ved en tastefejl. Det testene her
// beskytter, er de få steder hvor UDLEDNINGEN kunne gå galt — og de steder
// hvor noget skal VAERE VAEK.

describe('abonnementsvilkår — publiceret tekst', () => {
  const terms = da.terms as Record<string, string>

  it('har alle 16 paragraffer med overskrift', () => {
    for (let n = 1; n <= 16; n++) {
      expect(terms[`s${n}h`], `mangler overskrift for §${n}`).toBeTruthy()
    }
  })

  // 🔴 Kilden indeholder en intern redaktionel note i §7.3, adresseret til
  // workers og markeret med advarselstegn. Den maa ALDRIG naa en kunde.
  it('indeholder INGEN interne redaktionelle noter', () => {
    const all = JSON.stringify(terms)
    expect(all).not.toContain('\u26a0')
    expect(all).not.toContain('[account]')
    expect(all).not.toContain('[grundtone]')
    expect(all).not.toContain('bekræfter ved implementering')
  })

  // Kilden henviser til databehandleraftalen med en REPO-STI. En kunde skal
  // se et link til den publicerede side, ikke en filsti i vores git-tree.
  it('lækker ingen repo-stier', () => {
    const all = JSON.stringify(terms)
    expect(all).not.toContain('docs/legal')
    expect(all).not.toContain('.md')
  })

  // §13.4 er den bestemmelse, font-licens-fladen henviser til. Begge led
  // pinnes hver for sig: rettighederne OG videredistributionen. Falder det
  // ene bort, står teksten stadig og lyder rigtig.
  it('pinner begge led af indeståelsen i §13.4', () => {
    expect(terms.s13p4).toContain('du har de nødvendige rettigheder')
    expect(terms.s13p4).toContain('distribuere videre til dine slutbrugere')
  })

  // §10 er kode-verificeret adfærd: 3 dages betalingsfrist, 14 dages
  // CDN-grace. Aendres tallene i teksten uden at koden følger med, lyver vi.
  it('pinner de frister, koden håndhæver', () => {
    expect(terms.s10p1).toContain('3 dage')
    expect(terms.s10p2).toContain('14 dage')
    expect(terms.s12p3).toContain('30 dage')
  })
})

describe('sprogvalg — dansk er aftalesproget', () => {
  it('viser INGEN note på dansk', () => {
    expect((da.terms as Record<string, string>).langNotice).toBe('')
  })

  // 🔴 Noten skal staa på ENGELSK naar `en` er aktivt. En dansk note om at
  // teksten er dansk er ubrugelig for præcis den læser, den er skrevet til.
  it('viser en ENGELSK note på engelsk', () => {
    const notice = (en.terms as Record<string, string>).langNotice
    expect(notice).toContain('available in Danish only')
    expect(notice).toContain('Danish is the agreed contract language')
    expect(notice, 'noten skal være engelsk, ikke dansk').not.toMatch(/[æøåÆØÅ]/)
  })

  it('holder selve vilkårsteksten identisk på de to sprog', () => {
    const d = da.terms as Record<string, string>
    const e = en.terms as Record<string, string>
    for (const k of Object.keys(d)) {
      if (k === 'langNotice') continue
      expect(e[k], `${k} afviger mellem da og en`).toBe(d[k])
    }
  })
})

describe('font-licens-fladen henviser til vilkårene', () => {
  it('har henvisningen tilbage, nu hvor siden findes', () => {
    // Ingen bred cast: legalIndex har et nested `pages`-objekt, saa
    // Record<string, string> er ikke sandt for hele blokken.
    expect(da.legalIndex.fontLicensesTermsRef).toBeTruthy()
    expect(da.legalIndex.fontLicensesTermsLink).toContain('13')
  })
})
