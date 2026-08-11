import { describe, expect, it } from 'vitest'
import { looksLikeSvg, sanitizeSvg } from './svg-sanitize'

describe('sanitizeSvg', () => {
  it('strips script blocks', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>')
    expect(out).not.toContain('script')
    expect(out).toContain('<rect/>')
  })

  it('survives the nested-script bypass (fixpoint iteration)', () => {
    const out = sanitizeSvg('<svg><scr<script>alert(1)</script>ipt>alert(2)</script></svg>')
    expect(out).not.toContain('alert')
  })

  it('strips unterminated script blocks', () => {
    const out = sanitizeSvg('<svg><rect/><script>alert(1)')
    expect(out).not.toContain('alert')
  })

  it('strips foreignObject (HTML smuggling vector)', () => {
    const out = sanitizeSvg('<svg><foreignObject><iframe src="x"/></foreignObject><circle/></svg>')
    expect(out).not.toContain('foreignObject')
    expect(out).not.toContain('iframe')
    expect(out).toContain('<circle/>')
  })

  it('strips event handlers in both quote styles and unquoted', () => {
    const out = sanitizeSvg(
      `<svg onload="alert(1)"><rect onclick='alert(2)'/><g onmouseover=alert(3)></g></svg>`,
    )
    expect(out).not.toContain('alert')
    expect(out).not.toMatch(/\son[a-z]+/)
  })

  it('strips javascript: hrefs incl. xlink', () => {
    const out = sanitizeSvg(
      `<svg><a href="javascript:alert(1)">x</a><use xlink:href='javascript:alert(2)'/></svg>`,
    )
    expect(out).not.toContain('javascript:')
  })

  it('strips external http(s) references but keeps inline content', () => {
    const out = sanitizeSvg(
      `<svg><image href="https://evil.example/x.png"/><rect fill="url(#grad)"/></svg>`,
    )
    expect(out).not.toContain('evil.example')
    expect(out).toContain('url(#grad)')
  })

  it('leaves a clean logo untouched', () => {
    const clean = '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#0059b3"/></svg>'
    expect(sanitizeSvg(clean)).toBe(clean)
  })
})

describe('looksLikeSvg', () => {
  it('accepts plain, xml-prologed, doctyped and commented svg', () => {
    expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true)
    expect(looksLikeSvg('<?xml version="1.0"?><svg></svg>')).toBe(true)
    expect(looksLikeSvg('<?xml version="1.0"?>\n<!DOCTYPE svg><!-- x --><svg/>')).toBe(true)
  })

  it('rejects html and arbitrary content', () => {
    expect(looksLikeSvg('<!doctype html><html><body>x</body></html>')).toBe(false)
    expect(looksLikeSvg('PNG\x89 not svg')).toBe(false)
    expect(looksLikeSvg('')).toBe(false)
  })
})

describe('what the regex CANNOT catch (SIK-010) — CSP carries these', () => {
  // ⚠️ Disse cases asserterer at vektorerne OVERLEVER saniteringen. Det er
  // ikke en fejl der skal "rettes" ved at slække assertionen — det er
  // begrænsningen gjort eksekverbar, så den ikke kun står i en kommentar.
  //
  // De er inerte i produktion ALENE fordi /k svarer med
  // `CSP: sandbox; default-src 'none'`. Løsnes den CSP, bliver de til
  // stored XSS på app-originet. Skal saniteringen selv kunne bære dem,
  // kræver det en parser-baseret allowlist — og så vender disse tests om.
  const uncaught = {
    'SMIL animate sets href at render time':
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>',
    'SMIL set injects an event handler attribute':
      '<svg><set attributeName="onload" to="alert(1)"/></svg>',
  }

  for (const [name, vector] of Object.entries(uncaught)) {
    it(`survives sanitisation — by design, not by oversight: ${name}`, () => {
      expect(sanitizeSvg(vector)).toMatch(/alert|javascript:/i)
    })
  }
})

describe('vectors the tightened patterns DO catch (SIK-010 follow-up)', () => {
  it('strips handlers separated by a slash, not just whitespace', () => {
    // `/` er en gyldig attribut-separator i HTML — det oprindelige mønster
    // krævede whitespace og lod <svg/onload=…> passere.
    expect(sanitizeSvg('<svg/onload=alert(1)></svg>')).not.toMatch(/alert/i)
  })

  it('strips namespace-prefixed script elements', () => {
    expect(sanitizeSvg('<svg><svg:script>alert(1)</svg:script></svg>')).not.toMatch(/alert/i)
  })
})

// 🔴 SIK-014 — ReDoS i `looksLikeSvg`. Denne blok maaler TID, ikke korrekthed.
//
// [sikkerhed]s pointe, og den er hele grunden til at testen ser anderledes ud
// end resten af filen:
//
//   "De eksisterende `looksLikeSvg`-tests er alle groenne i dag og ville blive
//    ved med at vaere det."
//
// En korrekthedstest kan ikke fange defekten. Funktionen returnerede det
// RIGTIGE svar — den brugte bare otte sekunder paa det. Fraveaeret af et
// tidsloft er praecis dét, der lod hullet ligge i to gennemgange.
//
// Maalt paa den gamle regex: 20 kommentarer (162 bytes) = 7,9 ms, og hver
// ekstra kommentar FORDOBLER. 30 kommentarer (241 bytes) = ~8 sekunder.
// Funktionen klipper til 1000 tegn, hvilket tillader ~124 — loftet er ikke en
// beskyttelse.
describe('looksLikeSvg er ikke ReDoS-baar (SIK-014)', () => {
  /** Kommentar-raekke uden afsluttende `<svg`, saa motoren skal backtracke. */
  const evil = (n: number) => '<!--a-->'.repeat(n) + '<x'

  const timeMs = (fn: () => void) => {
    const t0 = process.hrtime.bigint()
    fn()
    return Number(process.hrtime.bigint() - t0) / 1e6
  }

  // 🔴 Stoerrelsen er VALGT, ikke tilfaeldig — og grunden er vaerd at kende,
  // fordi den aendrede testens design.
  //
  // Maalt paa den GAMLE regex: 20 kommentarer = 39 ms · 24 = 120 ms ·
  // 26 = 491 ms · 30 = ~52 SEKUNDER · 124 (det fulde 1000-tegns loft) =
  // vender ALDRIG tilbage.
  //
  // En assertion paa 124 ville derfor ikke FEJLE under en regression — den
  // ville HAENGE, og en synkron regex kan ikke afbrydes af vitest. CI ville
  // braende sin 20-minutters timeout og ligne et infrastruktur-problem frem
  // for en rod test. **En vagt, der straffer sit eget brud med en haengning
  // i stedet for et roedt svar, er en daarlig vagt.**
  //
  // 26 er valgt fordi den gamle regex dér er LANGSOM MEN ENDELIG (491 ms):
  // langt over loftet, saa regressionen fanges — og hurtigt nok til at
  // fejlen ankommer paa under et sekund.
  it('afviser 210 bytes ondt input paa under 100 ms', () => {
    expect(timeMs(() => looksLikeSvg(evil(26)))).toBeLessThan(100)
  })

  // 🔴 Og her fulgte jeg IKKE min egen begrundelse foerst: den oprindelige
  // udgave assertede paa det fulde 1000-tegns loft (124 kommentarer). Koert
  // som mutation HANG suiten i to minutter uden at melde noget — nooejagtig
  // den daarlige vagt, kommentaren ovenfor advarer imod. At skrive grunden
  // ned er ikke det samme som at foelge den.
  //
  // I stedet maales EGENSKABEN — at tiden ikke vokser eksponentielt med
  // inputtet — mellem to stoerrelser der begge er ENDELIGE paa den gamle
  // regex (39 ms og 491 ms). Under en regression er forholdet ~12x og
  // testen fejler paa under et sekund; med den utvetydige regex er det ~1x.
  it('vokser ikke eksponentielt med antallet af kommentarer', () => {
    const small = timeMs(() => looksLikeSvg(evil(20)))
    const large = timeMs(() => looksLikeSvg(evil(26)))
    // Rigeligt slack til en langsom runner og til maalestoej paa
    // sub-millisekund-tider; et eksponentielt blowup er 12x og derover.
    expect(large).toBeLessThan(Math.max(small * 5, 20))
  })

  // Tidsloftet maa ikke koebes for korrekthed: de samme inputs skal stadig
  // give de rigtige svar.
  it('svarer stadig rigtigt paa de onde inputs', () => {
    expect(looksLikeSvg(evil(26))).toBe(false)
    expect(looksLikeSvg('<!-- a --><!-- b --><svg />')).toBe(true)
    expect(looksLikeSvg('<!-- a -- b --><svg />')).toBe(true)
  })
})
