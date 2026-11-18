// 30blackbirds' egne tenants — undtaget beta-værnet. Kun SERVER-SIDE.
//
// 🔴 Hvorfor en env-var og ikke en hardkodet liste: jeg kunne ikke fastslå de
// kanoniske org-UUID'er. To par cirkulerer i repoerne
// (`…-630a-…`/`…-26a2-…` og `…-0000-…-1`/`…-0000-…-2`), og BEGGE optræder
// udelukkende i tests og dokumentation — ingen af dem i produktions-konfig.
// At bage et gættet UUID ind i en sikkerhedskontrol er værre end at lade den
// være tom: den ville se ud som en undtagelse og ikke være en.
//
// Værdierne bor derfor, hvor sandheden bor — hos den der deployer — og sættes
// af [infra] sammen med studios øvrige server-env.
//
// 🔴 Fejl-retningen er med vilje: er variablen usat eller tom, gælder INGEN
// undtagelse, og interne orgs behandles som alle andre i beta. En glemt
// konfiguration lukker altså mere, ikke mindre. Den modsatte default ville
// gøre en tastefejl til en åben dør.
//
// 🔴 Og hvad denne fil IKKE gør: den giver ikke ubegrænsede KVOTER. Grænser
// leveres af `account` (`entitlements.ts`: "limits are enforced as delivered",
// "absent key = unlimited"), og kravet om ubegrænset brug for interne tenants
// opfyldes dér — ved at account undlader at sende en grænse. En kvote-override
// her ville give TO håndhævelser af samme regel, som kan drive fra hinanden.
//
// Denne fil afgør ét spørgsmål: må dette org købe under beta.

function internalOrgIds(): Set<string> {
  return new Set(
    (process.env.STUDIO_INTERNAL_ORG_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

/**
 * True når org'et er et af 30blackbirds' egne.
 *
 * Org-id'et kommer fra `lookupOrgBySlug` — altså fra auth, ikke fra
 * request-bodyen. En klient kan hverken sætte listen eller vælge hvilket org
 * der slås op, og det er dét, der gør undtagelsen til andet end et flag.
 */
export function isInternalOrg(orgId: string): boolean {
  return internalOrgIds().has(orgId)
}

/**
 * Antal konfigurerede interne orgs. Bruges til boot-loggen.
 *
 * 🔴 [sikkerhed]s tilføjelse, og grunden er diagnostik frem for sikkerhed: en
 * tastefejl i et UUID fejler TAVST lukket. Den interne tenant rammer så
 * paywallet, og fejlen ligner en produktfejl frem for en konfigurationsfejl.
 * En kontrol der kun larmer ved fejl, gør tavshed tvetydig — derfor siger vi
 * ved boot, hvor mange id'er der faktisk blev læst.
 */
export function internalOrgCount(): number {
  return internalOrgIds().size
}
