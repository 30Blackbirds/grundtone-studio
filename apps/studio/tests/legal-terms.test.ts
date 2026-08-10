import { describe, it, expect } from 'vitest'
import da from '~~/i18n/locales/da.json'
import en from '~~/i18n/locales/en.json'
import { TERMS_VERSION } from '~~/lib/legal'

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

  // 🔴 Juras femte krav (consent-tekster.md): interne noter hoerer i
  // HTML-kommentarer, aldrig i broedteksten — heller ikke med advarselstegn.
  // Listen er juras egen. Bemaerk hvad der IKKE staar paa den: parenteser.
  // Juridisk tekst bruger dem legitimt ("(§4.3)", "(reverse charge)"), og et
  // parentes-forbud ville give falske positiver, man laerer at ignorere — og
  // en advarsel man ignorerer, er samme fejlklasse som den vi lige har ryddet.
  it('indeholder intet, der kun hoerer hjemme internt', () => {
    const all = JSON.stringify(terms)
    for (const banned of ['\u26a0', '[account]', '[grundtone]', '[jura]', 'docs/', '.md']) {
      expect(all, `publiceret tekst indeholder ${banned}`).not.toContain(banned)
    }
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

// 🔴 vue-i18n fejlkode 10: en RAA @ i en locale-streng er linked-message-
// syntaks og knaekker BUILDEN. Den har ramt os tre gange, og hverken tests
// eller typecheck ser den — kun `nuxt build`, altsaa senest muligt.
//
// Denne test flytter opdagelsen fra CI's build-step til suiten, og den
// daekker HELE locale-filen frem for kun vilkaarene: naeste forekomst
// kommer ikke noedvendigvis fra det samme sted.
describe('locale-strenge maa ikke indeholde raa @ (vue-i18n error 10)', () => {
  const walk = (obj: unknown, path: string[] = []): [string, string][] =>
    typeof obj === 'string'
      ? [[path.join('.'), obj]]
      : typeof obj === 'object' && obj !== null
        ? Object.entries(obj).flatMap(([k, v]) => walk(v, [...path, k]))
        : []

  it.each([
    ['da', da],
    ['en', en],
  ])('%s.json er fri for uescapede @', (_name, locale) => {
    const offenders = walk(locale)
      .filter(([, v]) => /(?<!\{')@(?!'\})/.test(v))
      .map(([k]) => k)
    expect(offenders, `brug {'@'} i stedet for @ i: ${offenders.join(', ')}`).toEqual([])
  })
})

// 🔴 Accept-checkboxen er det sted, kunden BINDER sig, og det sted en senere
// indsigelse ville pege paa. Vilkaarene er dansk-kun, saa den ENGELSKE
// checkbox skal sige det ([jura] 2026-08-05, §1b) — ellers accepterer en
// engelsktalende kunde en tekst, de ikke er blevet fortalt er paa dansk.
//
// Testen findes, fordi punktet IKKE var sporet noget andet sted: da jura
// spurgte, om det laa i checkout-leverancen, var strengen live og forkert.
describe('accept-checkboxen fortaeller, at vilkaarene er danske', () => {
  it('den engelske label naevner sproget', () => {
    expect(en.plans.confirm.tosLabel).toContain('in Danish')
  })

  it('den danske label goer det ikke — dansk er aftalesproget', () => {
    expect(da.plans.confirm.tosLabel).not.toContain('dansk')
  })
})

// ─── Paragraf-sekvens paa den PUBLICEREDE tekst ─────────────────────────────
//
// [jura] afviste min oprindelige noegle-optaelling, og med en god grund: den
// viser at ANTALLET skred, ikke HVILKEN klausul der forsvandt — og den skal
// vedligeholdes i haanden, saa den, der lige har tabt en paragraf ved uheld,
// opdaterer bare tallet. Sekvens-kravet subsumerer den og er mere informativt.
//
// Den egentlige rettelse af [review]s mutation ligger i UDTRAEKKEREN, som nu
// fejler paa en uparsbar bestemmelse frem for at springe den over. Denne test
// er det andet net: den daekker den committede flade, ogsaa hvis nogen
// haand-redigerer JSON'en uden at koere udtraekket.
describe('paragraf-sekvensen i den publicerede tekst er ubrudt', () => {
  const terms = da.terms as Record<string, string>

  it('har §1–§16 uden huller og uden dubletter', () => {
    const found = Object.keys(terms)
      .map((k) => /^s(\d+)h$/.exec(k)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b)
    expect(found).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
  })

  it('har mindst ét afsnit eller punkt i hver paragraf', () => {
    const empty = Array.from({ length: 16 }, (_, i) => i + 1).filter(
      (n) => !Object.keys(terms).some((k) => new RegExp(`^s${n}(p\\d+|b\\d+)`).test(k)),
    )
    expect(empty, `paragraffer uden indhold: §${empty.join(', §')}`).toEqual([])
  })
})

// 🔴 VERSIONS-LABELEN — [jura]s fund: strengen fandtes i tre haandholdte
// kopier, saa teksten var sikret ved konstruktion mens LABELEN paa teksten var
// sikret ved disciplin. Vi kunne vise 1.1-teksten, skrive "Version 1.0"
// nederst og gemme "1.0" i bevis-sporet — alle tre led internt konsistente,
// hele attesten forkert.
//
// Testene her binder de tre sammen, saa de ikke kan skride hver for sig.
describe('versions-labelen er udledt, ikke haandholdt', () => {
  it('locale, bevis-spor og vist linje er den SAMME version', () => {
    const version = (da.terms as Record<string, string>).version
    expect(version).toMatch(/^studio-tos-\d+\.\d+$/)
    expect(TERMS_VERSION, 'bevis-sporet gemmer en anden version end fladen viser').toBe(version)
    expect((da.terms as Record<string, string>).versionLine).toContain(version)
  })

  it('de to sprog viser samme version', () => {
    expect((en.terms as Record<string, string>).version).toBe(
      (da.terms as Record<string, string>).version,
    )
  })
})
