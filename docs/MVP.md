# Grundtone Studio — MVP-plan

Multi-tenant SaaS hvor organisationer konfigurerer deres design system (design tokens) via en web-UI
og distribuerer dem til egne Vue/Nuxt/React-apps via en npm-pakke + API-nøgle.

Det er **ikke** et CMS. Produktet leverer kun konfiguration af et allerede-eksisterende design
system (Grundtone).

---

## 1. Vision

Kunden logger ind, opretter en organisation, inviterer teammedlemmer, opretter et projekt (= en
design-system-instans), konfigurerer tokens, opretter en API-nøgle, og installerer snippet'en i
deres kode:

```ts
import { grundtone } from '@grundtone/saas-client'
createApp(App).use(grundtone, { apiKey: 'pk_live_7a3f9c2e8b1d' }).mount('#app')
```

Eller via ren CDN/script-tag for kunder der ikke vil have en npm-afhængighed:

```html
<script src="https://cdn.grundtone.io/client/v1.js" data-api-key="pk_live_7a3f9c2e8b1d"></script>
<link rel="stylesheet" href="https://cdn.grundtone.io/k/pk_live_7a3f9c2e8b1d/tokens.css" />
```

Kundens app henter tokens fra CDN og kører `applyThemeToDOM` fra `@grundtone/core`. Kundens egne
`@grundtone/vue`-komponenter lyser op med deres brand.

## 2. Kerneindsigt

Grundtone-designsystemet har allerede `@grundtone/core` med `applyThemeToDOM` og runtime-theming.
Det betyder:

- **Ingen per-tenant npm-publishing nogensinde.** `@grundtone/vue` og `@grundtone/saas-client`
  publiceres én gang, bruges af alle kunder. Tenant-data flyder ind i runtime via API-nøgle, ikke
  som pakker.
- **Ingen navnekonflikter, ingen npm-accounts, ingen scope-administration** hos kunden.
- **Opdateringer rammer kunden øjeblikkeligt** via CDN, uden rebuild.
- **CSS-variabler har ingen SEO-impact**, så runtime config er uproblematisk.

## 3. Scope-adskillelse

**Open source (KlangHaus/grundtone — public):**

- `@grundtone/core`, `@grundtone/vue`, `@grundtone/nuxt`, `@grundtone/react-native`
- `@grundtone/design-tokens`, `@grundtone/icons`, `@grundtone/utils`
- **`@grundtone/saas-client`** (ny — SDK der taler med Studio's API)

**Commercial / private (KlangHaus/grundtone-studio — dette repo):**

- Nuxt 3 SaaS-app
- Better Auth, multi-tenant logik
- Token-editor UI
- Publish-pipeline
- UpCloud deployment

Studio forbruger `@grundtone/*` via npm — præcis som kunderne gør. "Eat your own dog food."

## 4. Arkitektur

```
[grundtone-studio — Nuxt 3]              [Kundens site]
  Better Auth (org-plugin)                 use(grundtone, { apiKey: 'pk_live_...' })
  UpCloud Postgres                              │
  UpCloud Object Storage                        ▼
  Token-editor UI                          applyThemeToDOM(config.tokens)
       │
       └─ Publish →                        CDN-fetch
          Object Storage                      ▲
          ↓                                   │
          Bunny.net CDN  ──────► /k/pk_live_.../config.json (resolveret server-side)
```

Edge-laget (Bunny.net edge script eller Nitro-proxy) resolverer `pk_live_...` → `project_id` →
serverer korrekt blob. Resolution caches aggressivt (LRU, 60s TTL).

## 5. Stack

| Lag              | Valg                                                                        | Begrundelse                                    |
| ---------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| App-framework    | **Nuxt 3 (Nitro SSR)**                                                      | Matcher Grundtone-økosystemet                  |
| Hosting          | **UpCloud** (VM m. Docker Compose i MVP, UKS senere)                        | EU, GDPR-venligt, ingen Vercel-lock-in         |
| Database         | **UpCloud Managed PostgreSQL** + Drizzle ORM                                | EU-residency, auto-snapshot                    |
| Auth             | **Better Auth** (self-hosted, MIT) med `organization`-plugin                | Multi-tenant, TS-native, data i vores Postgres |
| Config storage   | **UpCloud Object Storage** (S3-kompatibel)                                  | EU, blob-paths keyed på `pk_live_...`          |
| CDN              | **Bunny.net** foran Object Storage                                          | EU-venligt, billigt, hurtigt                   |
| Email            | **Postmark EU** eller **Scaleway Transactional Email**                      | Magic links, invites — EU m. DPA               |
| Error tracking   | **Sentry EU-region** eller self-hosted **GlitchTip**                        | EU-residency                                   |
| SDK-distribution | **npm + CDN-bundle**                                                        | Begge aftermode understøttes                   |
| Deploy           | GitHub Actions → Docker image → UpCloud Container Registry → rolling update | Standard                                       |

## 6. Strategiske beslutninger

1. **Runtime config, aldrig per-tenant npm** — kunden opretter aldrig en npm-bruger. Tenant-data
   loades i runtime via API-nøgle.
2. **CDN-primær + npm som supplement** — begge flows understøttes fra dag ét.
3. **Slug (human) + API-token (machine)** — `organization.slug` bor i dashboard-URLs, invites, audit
   logs. `pk_live_...` bor i client-kode og CDN-paths. De overlapper aldrig i integrationen.
4. **Better Auth, ikke Clerk, ikke fra-scratch** — selv-hostet bibliotek, al data i vores Postgres.
5. **UpCloud i stedet for Vercel** — fuld kontrol, EU-data, ingen lock-in.
6. **Separat private repo** — kommerciel kode må ikke leve i public grundtone-monorepoet.

## 7. Datamodel

Better Auth håndterer user/org/member/session-tabellerne. Studio-specifikt:

```
// Better Auth-tabeller (auto-genererede)
user(id, email, emailVerified, ...)
session(id, userId, expiresAt, ...)
organization(id, name, slug, ...)           // human-readable: fx 'acme-corp'
member(id, organizationId, userId, role)
invitation(...)

// Grundtone Studio-specifikke
project(
  id,
  organization_id,                           // én org kan have flere brands
  slug,                                      // projekt-slug, fx 'main' eller 'landing'
  name,
  created_at
)

api_key(
  id,
  project_id,
  key_hash,                                  // hash, aldrig plaintext
  key_prefix,                                // 'pk_live_7a3f' (til UI: last-used, genkendelse)
  key_type,                                  // 'publishable' (secret er post-MVP)
  environment,                               // 'live' | 'test'
  allowed_origins json,                      // ['acme.com', '*.acme.com']
  rate_limit int,
  last_used_at,
  revoked_at,                                // soft-revoke
  created_by,
  created_at
)

config_version(
  id,
  project_id,
  version,                                   // auto-increment pr. projekt
  tokens_json,                               // farver, type, spacing, radius
  status,                                    // 'draft' | 'published'
  published_at,
  published_by
)

active_version(project_id, config_version_id)   // hvilken version CDN'et serverer
```

**Plaintext-token vises kun én gang** ved oprettelse (som GitHub PATs, Stripe keys). Rotation: opret
ny → kunden opdaterer snippet → revoker gammel. Overlap muligt.

**Hierarki:**

```
organization (slug: acme-corp)
  └─ project (slug: main)
      ├─ api_key (pk_live_7a3f...)    ← produktion
      ├─ api_key (pk_test_8b2e...)    ← staging/dev
      └─ config_versions
```

**Publish-flow:** ny `config_version` skrives → JSON + CSS-variabel-fil genereres → uploades til
Object Storage under `k/{keyPrefix}/v{n}/` → `active_version`-pointer opdateres → CDN serverer
næsten øjeblikkeligt.

## 8. Faseplan (~4 uger samlet for solo-udvikler)

### Fase 0 — Fundament (1 uge)

- Scaffold Nuxt 3 + TypeScript + Drizzle
- Docker Compose til lokal udvikling: Nuxt + Postgres + MinIO (S3-stand-in)
- Better Auth opsat med `organization`-plugin, magic link via valgt email-provider
- Drizzle-schema for `project`, `api_key`, `config_version`, `active_version`
- Dashboard shell: login, org-oprettelse, invites, projekt-oprettelse
- UpCloud-setup: VM, Managed Postgres, Object Storage bucket, Bunny.net CDN

### Fase 1 — Token editor + distribution (2 uger)

- Form-UI for tokens (farver, typografi, spacing, radius) — genbrug `@grundtone/design-tokens` som
  defaults
- API-nøgle CRUD: opret, liste, rotere, revokere; vis plaintext én gang; allowed_origins-formular
- "Publish"-knap → serializer JSON + genererer CSS-variabel-fil → uploader til Object Storage under
  `k/{keyPrefix}/v{n}/`
- Ny pakke i grundtone-monorepo: **`@grundtone/saas-client`** (publiceres til npm + CDN):
  - `loadByApiKey(apiKey, { cdnBase? })` (programmatisk)
  - Vue-plugin: `use(grundtone, { apiKey })`
  - Script-tag auto-init: læser `data-api-key`
  - Applicerer tokens via `@grundtone/core`'s `applyThemeToDOM`
- Install-snippets i dashboardet

### Fase 2 — Polish + docs (1 uge)

- Version-historik + "activer version N"-knap (immutable blobs, pointer-switch)
- Onboarding-flow fra signup til første publish
- Dokumentation for kunden: integration-guides pr. framework
- Integrationstest + CI-pipeline (GitHub Actions)
- Staging-miljø på separat UpCloud VM

## 9. Post-MVP roadmap (prioriteret)

1. Preview-side — "se dit design system live" demo
2. Hero-editor + schema-drevet form-UI + `<GrundtoneRenderer>`
3. Image-upload + CDN-optimering (Sharp eller Bunny image-proc)
4. Stripe billing (per seat eller per tenant TBD)
5. SSR-modul (`@grundtone/nuxt-saas`) for kunder der laver marketing-sites
6. React Native-support i saas-client
7. Drag-drop sektion-builder
8. Secret keys (`sk_live_...`) + admin-API til CI/CD-publish
9. Custom domains pr. tenant (Caddy/Traefik reverse-proxy)
10. Usage-analytics + dashboard-metrics

## 10. GDPR

### Infrastruktur (alt EU)

- [x] UpCloud Postgres (Helsinki/Frankfurt/London)
- [x] UpCloud Object Storage (EU)
- [x] Bunny.net CDN (har EU zones)
- [ ] Email-provider: Postmark EU / Scaleway / Amazon SES eu-central-1
- [ ] Sentry EU-region eller self-hosted GlitchTip

### Auth (Better Auth-specifikt)

- Alle brugerdata i egen Postgres, ingen ekstern processor
- **Ingen OAuth-providers i MVP** — kun email + magic link. OAuth kan tilføjes senere med
  cookie-consent.
- Session-cookies er "strictly necessary" → ingen consent-banner krævet, men dokumenteres i privacy
  policy

### Politikker og flows

- [ ] Privacy policy + cookie-oplysning
- [ ] DPA (databehandleraftale) som kunder kan signe med os
- [ ] Sub-processor-liste: UpCloud, Bunny.net, email-provider
- [ ] Retention policy for IP-/login-logs (30–90 dage)
- [ ] User delete-flow der reelt sletter data
- [ ] Data export-endpoint (GDPR art. 20)
- [ ] Tenant-deletion-flow (cascade: configs, api_keys, members)

## 11. Åbne beslutninger

| Beslutning               | Standard indtil videre                                                               | Afklares inden |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------- |
| Deploy-target på UpCloud | Enkelt VM m. Docker Compose (billigere, enklere i MVP)                               | Fase 0         |
| Email-provider           | Postmark EU (hvis budget) eller Scaleway                                             | Fase 0         |
| Sentry-strategi          | Sentry EU-region (hvis budget) eller GlitchTip self-hosted                           | Fase 0         |
| Origin-check-laget       | Bunny.net edge-script vs Nitro-proxy foran                                           | Fase 1         |
| UpCloud vs Hetzner       | UpCloud (user-valgt); Hetzner blev noteret som alternativ med bedre priser/community | Inden Fase 0   |

## 12. Kendte risici / åbne antagelser at validere

1. **Bunny.net edge-scripting kapacitet** — har det tilstrækkelige features til origin-check? Ellers
   må Nitro sidde foran alt CDN-traffic. Testes i Fase 1.
2. **Better Auth's `organization`-plugin** — virker invites, roller og seat-billing-koblingen som
   forventet? Testes i Fase 0.
3. **`applyThemeToDOM` i runtime-kontekst** — er funktionen designet til at blive kaldt på en
   fremmed side efter mount, eller forudsætter den noget? Tjekkes inden Fase 1.
4. **PMF** — ingen kundesamtaler endnu. Bør valideres parallelt med Fase 0.
5. **Rate limiting** — `api_key.rate_limit` som DB-kolonne er naivt, skal på sigt til Redis.
   Acceptabelt for MVP hvor volumen er lavt.

## 13. Næste skridt

1. Scaffold Nuxt 3 + Drizzle + Better Auth + Docker Compose
2. Provisionere UpCloud-ressourcer (VM, Postgres, Object Storage)
3. Vælge og konfigurere email-provider
4. Starte Fase 0
