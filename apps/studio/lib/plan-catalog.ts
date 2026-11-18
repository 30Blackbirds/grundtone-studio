// Studio plan catalog for the pricing/upgrade UI. Structure follows the
// designer's v2 prototypes (docs/design/grundtone-studio/prototypes/billing-*)
// and CMO's tier doc (market/grundtone-studio/2026-08-01-tier-struktur.md).
//
// ALL € amounts are PLACEHOLDER intro anchors — finance's cost-floor and
// Allan's final yes are pending, and CMO/designer both mandated config-not-
// hardcode. Change numbers HERE only; nothing else in the UI carries prices.
// Display strings live in i18n under `plans.*`; this module is mechanical.
// Checkout only ever sends the plan KEY across the account boundary (C3).

export type PlanKey =
  'studio_free' | 'studio_solo' | 'studio_studio' | 'studio_scale' | 'studio_enterprise'

export interface PlanFeature {
  /** i18n key under plans.features.* */
  labelKey: string
  included: boolean
}

export interface PlanDef {
  key: PlanKey
  /** null = custom/contact-sales (Enterprise) */
  priceEur: number | null
  /** Included active brands; null = custom */
  brandsIncluded: number | null
  /** €/month per extra brand; null = no overage (hard cap or custom) */
  overageEurPerBrand: number | null
  hardCap: boolean
  highlighted?: boolean
  isNew?: boolean
  /** Purchasable via checkout (Free and Enterprise are not) */
  purchasable: boolean
  features: PlanFeature[]
}

const YES = (labelKey: string): PlanFeature => ({ labelKey, included: true })
const NO = (labelKey: string): PlanFeature => ({ labelKey, included: false })

export const PLAN_CATALOG: PlanDef[] = [
  {
    key: 'studio_free',
    priceEur: 0,
    brandsIncluded: 2,
    overageEurPerBrand: null,
    hardCap: true,
    purchasable: false,
    features: [
      YES('unlimitedMembers'),
      YES('tokenEditor'),
      YES('cdnFairUse'),
      YES('history10'),
      NO('emailTemplates'),
      NO('provisioningApi'),
      NO('rollback'),
    ],
  },
  {
    key: 'studio_solo',
    priceEur: 29,
    brandsIncluded: 3,
    overageEurPerBrand: null,
    hardCap: true,
    isNew: true,
    purchasable: true,
    features: [
      YES('unlimitedMembers'),
      YES('emailTemplates'),
      YES('provisioningApi'),
      YES('fullHistoryRollback'),
      YES('basicAudit'),
      NO('ssoScim'),
      NO('selfHost'),
    ],
  },
  {
    key: 'studio_studio',
    priceEur: 59,
    brandsIncluded: 10,
    overageEurPerBrand: 8,
    hardCap: false,
    highlighted: true,
    purchasable: true,
    features: [
      YES('unlimitedMembers'),
      YES('emailTemplates'),
      YES('provisioningApi'),
      YES('fullHistoryRollback'),
      YES('basicAudit'),
      NO('ssoScim'),
      NO('selfHost'),
    ],
  },
  {
    key: 'studio_scale',
    priceEur: 179,
    brandsIncluded: 50,
    overageEurPerBrand: 5,
    hardCap: false,
    purchasable: true,
    features: [
      YES('unlimitedMembers'),
      YES('allFromStudio'),
      YES('highCdnQuota'),
      YES('fullAudit'),
      YES('prioritySupport'),
      NO('ssoScim'),
      NO('selfHost'),
    ],
  },
  {
    key: 'studio_enterprise',
    priceEur: null,
    brandsIncluded: null,
    overageEurPerBrand: null,
    hardCap: false,
    purchasable: false,
    features: [
      YES('unlimitedMembers'),
      YES('allFromScale'),
      YES('ssoScim'),
      YES('selfHost'),
      YES('dedicatedSupport'),
    ],
  },
]

/**
 * 12-month intro price lock line (Allan-approved 2026-07-30). Stays a config
 * flag + i18n string — [jura] owns the precise legal scoping in the ToS draft
 * (per tier? on upgrade? new features?); if they scope it differently, the
 * marketing copy must be able to follow without a code change.
 */
/**
 * De plan-nøgler checkout-endepunktets body-skema accepterer.
 *
 * Bor her frem for i ruten, så testen kan læse den SAMME liste som skemaet
 * bruger. Stod listen som et literal i `checkout-session.post.ts` og et andet
 * literal i testen, målte testen sin egen kopi: en ny nøgle i ruten ville
 * ikke gøre noget rødt. Mutationstest 2026-08-28 viste præcis det.
 *
 * Alle nøgler her SKAL være `purchasable` — pinnet i checkout-session.test.ts.
 * Det er dét, der holder handlerens purchasable-tjek som en ubrugt backstop
 * frem for en gren, hvis placering nogen skal gætte sig til.
 */
export const CHECKOUT_PLAN_KEYS = ['studio_solo', 'studio_studio', 'studio_scale'] as const

export const SHOW_PRICE_LOCK_LINE = true

// ─── Beslutning AL (Allan, 2026-08-27): Q4 2026 = BETA ──────────────────────
// Kun gratis-modellen kan vælges. De betalte tiers VISES som "Kommer
// 1. januar 2027" (annonceret, ikke købbar), og købs-stien er lukket
// SERVER-SIDE i server/api/billing/checkout-session.post.ts +
// portal-session.post.ts (403, juras fejlkode `beta_paid_plans_closed`) —
// en skjult knap er ingen håndhævelse. Kanonisk tekst + kravliste:
// docs-repoet legal/consent-tekster.md, label `studio-beta-1.0`.
//
// Jura-krav pkt. 3: genåbning ved EKSPLICIT konfiguration, ikke ur — flippes
// til false i sin EGEN PR ved officiel launch 1/1-2027, en menneskelig
// handling gennem Allans tag-cut. Et ur ville åbne salget, selv hvis en
// launch-gate (jura/billing/Billy-cutover) var skredet. Ved flip: fjern
// beta-teksterne + tests/beta-copy.test.ts i samme commit (labelen udgår),
// og priceLock-linjen må KUN genopstå som juras kanoniske §6-kortformulering.
// tests/beta-copy.test.ts pinner flaget, så flip-PR'en SKAL røre testen.
export const BETA_MODE = true

export function getPlan(key: PlanKey): PlanDef {
  return PLAN_CATALOG.find((p) => p.key === key)!
}

/**
 * Every plan_key account can return for grundtone-studio, spelled exactly as
 * account spells it. Account's FeatureCatalog owns plan_key and is MIXED:
 * its default/legacy/internal plans use a hyphen, the three paid plans the
 * underscore of their Stripe lookup_key ([account] 2026-10-27, measured in
 * account src/entitlements/service.ts). Renaming there is a prod data
 * migration, so Studio maps here, in one place.
 *
 * 🔴 Comparing account's key to `PlanKey` directly is the bug this replaces:
 * `studio-free` matched no catalog entry, so brand-quota saw no hard cap and a
 * free org could activate brands without limit.
 */
export const ACCOUNT_PLAN_KEYS = [
  'studio-free',
  'studio-legacy',
  'studio-internal',
  'studio_solo',
  'studio_studio',
  'studio_scale',
] as const
export type AccountPlanKey = (typeof ACCOUNT_PLAN_KEYS)[number]

// null = a plan account assigns but Studio does not sell: legacy (unlimited,
// every org that predates the free tier) and internal (30blackbirds' own org).
// Neither has a catalog entry, so neither has a cap or an overage rate.
const CATALOG_KEY_BY_ACCOUNT_KEY: Record<AccountPlanKey, PlanKey | null> = {
  'studio-free': 'studio_free',
  'studio-legacy': null,
  'studio-internal': null,
  studio_solo: 'studio_solo',
  studio_studio: 'studio_studio',
  studio_scale: 'studio_scale',
}

function isAccountPlanKey(key: string): key is AccountPlanKey {
  return (ACCOUNT_PLAN_KEYS as readonly string[]).includes(key)
}

/** Studio's catalog entry for a plan_key from account, or null when it has none. */
export function planForAccountKey(key: string | null | undefined): PlanDef | null {
  if (!key || !isAccountPlanKey(key)) return null
  const catalogKey = CATALOG_KEY_BY_ACCOUNT_KEY[key]
  return catalogKey ? getPlan(catalogKey) : null
}

/**
 * The `plans.names.*` i18n key to show for a plan_key from account, including
 * legacy and internal, which have a name but no catalog entry. null for a key
 * account is not known to return; the caller shows the raw key.
 */
export function planNameKeyForAccountKey(key: string | null | undefined): string | null {
  if (!key || !isAccountPlanKey(key)) return null
  return CATALOG_KEY_BY_ACCOUNT_KEY[key] ?? key.replace('-', '_')
}

// Jura/Allan-låst loft 2026-08-04: "4 fontfiler i alt" på tværs af de to
// font-slots (fil-formulering så kursiv-filer utvetydigt tæller med). Bor
// HER som config-konstant (ikke spredt i valideringer) så en senere
// justering — fx Enterprise-forhøjelse — er ét sted. Skal fremgå af /plans
// (aftale-kilden) og må bevidst IKKE stå i ToS.
export const MAX_FONT_FILES_TOTAL = 4
