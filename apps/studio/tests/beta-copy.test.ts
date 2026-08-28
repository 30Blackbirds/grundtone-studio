import { describe, expect, it } from 'vitest'
import da from '../i18n/locales/da.json'
import en from '../i18n/locales/en.json'
import { BETA_NOTICE_VERSION } from '../lib/legal'
import { BETA_MODE, PLAN_CATALOG } from '../lib/plan-catalog'

// Ordret pinning af `studio-beta-1.0` (docs-repoet legal/consent-tekster.md,
// Beslutning AL). Juras krav pkt. 1: det viste SKAL være det kanoniske,
// byte-identisk — så teksten kan ikke omskrives "for læsbarhed" uden at juras
// dokument ændres først og denne test bevidst opdateres.
//
// 🔴 Hele strengen pinnes, ikke et nøgleord. En delvis pinning ville lade en
// omskrivning bestå, så længe ét ord overlevede — og det er netop
// helhedsformuleringen, der bærer retsvirkningen.

const DA_NOTICE =
  'Grundtone Studio er i beta. Den gratis plan er den eneste, der kan tegnes i ' +
  'beta-perioden. De betalte planer er annonceret og åbner for køb den 1. januar 2027 — ' +
  'indtil da kan de hverken købes eller forudbestilles. Annoncerede priser er ' +
  'introduktionspriser og er vejledende frem til lanceringen.'

const EN_NOTICE =
  'Grundtone Studio is in beta. The free plan is the only plan available during the ' +
  'beta period. The paid plans are announced and open for purchase on 1 January 2027 — ' +
  'until then they can be neither purchased nor pre-ordered. Announced prices are ' +
  'introductory prices and are indicative until launch.'

describe('studio-beta-1.0 — ordret pinning', () => {
  it('pinner den danske notice byte-identisk', () => {
    expect(da.plans.beta.notice).toBe(DA_NOTICE)
  })

  it('pinner den engelske notice byte-identisk', () => {
    expect(en.plans.beta.notice).toBe(EN_NOTICE)
  })

  // Beslutning AL's egen ordlyd. Den ERSTATTER købs-knapperne, så den er det
  // eneste, en læser får at vide om hvornår køb åbner.
  it('pinner badge-teksten ordret på begge sprog', () => {
    expect(da.plans.beta.comingSoon).toBe('Kommer 1. januar 2027')
    expect(en.plans.beta.comingSoon).toBe('Coming 1 January 2027')
  })

  it('pinner versionslabelen', () => {
    expect(BETA_NOTICE_VERSION).toBe('studio-beta-1.0')
  })
})

describe('jura-krav der ikke er tekst', () => {
  // Pkt. 6: intro-pris-løftet lover noget til folk, der ikke kan tegne.
  it('viser ikke pris-garantien mens beta er slået til', () => {
    expect(BETA_MODE).toBe(true)
  })

  // Pkt. 7 (stående krav): momsnotitsen skal stå på selve prissiden.
  it('har momsnotitsen på begge sprog', () => {
    expect(da.plans.vatExclNote).toBe('Priser er ekskl. moms.')
    expect(en.plans.vatExclNote).toBe('Prices are exclusive of VAT.')
  })

  // 🔴 Flaget pinnes, så launch-PR'en SKAL røre denne fil. Uden det kunne
  // nogen flippe BETA_MODE og efterlade beta-teksterne stående — fladen ville
  // så sige "kan ikke købes" mens købs-knapperne virkede.
  it('tvinger launch-flippet gennem denne test', () => {
    expect(BETA_MODE).toBe(true)
  })

  // 🔴 `purchasable` er IKKE beta-tilstand. Feltets egen doc siger "Purchasable
  // via checkout (Free and Enterprise are not)" — det er plan-TAKSONOMI, og
  // `plan-catalog.test.ts` pinner allerede de tre betalte som purchasable.
  // Beta-lukningen bæres af BETA_MODE + server-værnet, ikke af dette felt.
  // Testen står her, fordi det er den forveksling, en læser vil gøre.
  it('lader purchasable være taksonomi — beta lukker ANDETSTEDS', () => {
    const paid = PLAN_CATALOG.filter((p) => p.purchasable).map((p) => p.key)
    expect(paid).toEqual(['studio_solo', 'studio_studio', 'studio_scale'])
  })
})
