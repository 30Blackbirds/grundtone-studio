# Roadmap — Grundtone Studio

Implementationsplan opdelt i konkrete faser. Bygger på [MVP.md](./MVP.md) (vision og scope) og
[architecture.md](./architecture.md) (visuel arkitektur).

Hver fase ender med en demo-bar tilstand. Faserne er sekventielle for solo-udvikler; kan delvis
parallelliseres med ekstra hænder. Hele stacken er TypeScript end-to-end.

---

## Fase 0 — Workspace + infrastruktur (1 uge)

**Mål:** Tom Studio-app der booter, mod ægte UpCloud-ressourcer.

### Repo-struktur

- [ ] Opret `apps/studio/` og flyt eksisterende Nuxt-kode dertil (app.vue, pages, server, lib,
      middleware, drizzle.config.ts)
- [ ] Opret `packages/saas-client/` skelet (package.json, src/index.ts placeholder)
- [ ] `pnpm-workspace.yaml` + `turbo.json` på rod
- [ ] Beslut placering af `Caddyfile`, `docker-compose.*.yml`, `Dockerfile` (rod vs `apps/studio/`)
- [ ] Opdater root `package.json` med workspace-scripts (`build`, `dev`, `lint`, `test`)

### Lokal udvikling

- [ ] `docker-compose.dev.yml`: Nuxt-app + Postgres + MinIO (S3-stand-in)
- [ ] `.env.example` med alle nødvendige variabler dokumenteret
- [ ] Drizzle migration-runner ved app-start

### UpCloud-provisionering (staging først)

- [ ] VM (1 vCPU / 2 GB / Helsinki eller Frankfurt) med Docker Compose
- [ ] Managed PostgreSQL 17 (DEV-1x1 i staging)
- [ ] Object Storage bucket `studio-staging-configs`
- [ ] Bunny.net pull zone foran Object Storage
- [ ] DNS: `studio-staging.klanghaus.com` → VM IP, `cdn-staging.grundtone.io` → Bunny.net

### Deploy-pipeline

- [ ] GitHub Actions: build Docker image → push til GHCR
- [ ] Server-side: `docker compose pull && up -d` via runbook (manuel i Fase 0, automatiseret i
      Fase 5)

**Demo-mål:** `https://studio-staging.klanghaus.com` viser tom Nuxt-side. Login findes ikke endnu.

---

## Fase 1 — Auth + multi-tenant (1 uge)

**Mål:** Designer kan oprette org, invitere medlemmer, oprette projekter.

### Better Auth setup

- [ ] Installer `better-auth` + `@better-auth/organization`
- [ ] Drizzle-schema for Better Auth-tabeller (user, session, organization, member, invitation)
- [ ] Email-provider valgt (Postmark EU vs Scaleway) + magic link konfigureret
- [ ] `BETTER_AUTH_SECRET` i UpCloud secrets

### Studio-specifik datamodel

- [ ] Drizzle-tabeller: `project`, `api_key` (skelet), `config_version` (skelet), `active_version`
- [ ] Migrations + seed-script til lokal udvikling

### Dashboard shell

- [ ] Layout: top-nav (org-switcher), sidebar (projekter)
- [ ] Login-side (magic link)
- [ ] Org-oprettelse efter første login
- [ ] Invite-flow: email → magic link med org-context
- [ ] Roller: `owner`, `admin`, `member` med UI-gates
- [ ] Projekt-CRUD inden for org

### A11y / i18n

- [ ] Dansk + engelsk fra start (i18n-modul)
- [ ] Accessibility-grundlag: skip-link, focus-styles, ARIA på interaktive elementer

**Demo-mål:** Designer signer up, opretter org "Acme", inviterer kollega, opretter projekt "Main".

---

## Fase 2 — Token editor + API keys (1 uge)

**Mål:** Designer kan editere tokens og generere en API-nøgle.

### Token editor UI

- [ ] Form til farver (med color picker + WCAG kontrast-validering)
- [ ] Form til typografi (font-family, size scale)
- [ ] Form til spacing (skala-baseret)
- [ ] Form til radius
- [ ] Live preview-panel der bruger `applyThemeToDOM` på en isoleret container
- [ ] Defaults fra `@grundtone/design-tokens`
- [ ] Draft-state med "discard changes"

### API-key management

- [ ] Generate key: `pk_live_<32 hex>` eller `pk_test_<32 hex>`
- [ ] Hash i DB (bcrypt eller argon2), aldrig plaintext
- [ ] `key_prefix` (første 12 tegn) gemmes for genkendelse i UI
- [ ] Plaintext vises **én gang** ved oprettelse
- [ ] Liste, rotate, revoke (soft-delete via `revoked_at`)
- [ ] `allowed_origins`-formular (CORS-allowlist)
- [ ] `rate_limit` placeholder i schema (håndhævelse i Fase 5)

**Demo-mål:** Designer ændrer primær-farven til pink, ser preview opdatere live, gemmer som draft.

---

## Fase 3 — Publish pipeline (1 uge)

**Mål:** Designer trykker "publish" og en CDN-URL serverer tokens.

### Server-side publish

- [ ] Nitro-route `POST /api/projects/:id/publish`
  - Valider draft → generér ny `config_version` (auto-increment)
  - Serializer JSON + render CSS-fil med variabler på `:root`
  - Upload til Object Storage: `k/{key_prefix}/v{n}/tokens.json` + `tokens.css`
  - UPDATE `active_version` → ny version
  - Invalider Bunny.net cache (purge by URL eller tag)

### CDN-resolver

- [ ] Edge-script eller Nitro-proxy: `cdn.grundtone.io/k/pk_live_xxx/config.json`
  - Resolverer `pk_live_...` → `project_id` → `active_version_id`
  - Henter blob fra Object Storage
  - Returnerer med korrekte CORS-headers
  - Cache-Control + ETag for client-side caching

### Version-historik

- [ ] Liste over alle config_versions for projekt
- [ ] "Activer denne version" — pointer-switch (immutable blobs, ingen rewrite)
- [ ] Diff mellem to versioner (post-MVP, men værd at scaffolde)

**Demo-mål:** Designer publish'er →
`curl https://cdn-staging.grundtone.io/k/pk_live_xxx/tokens.json` returnerer JSON.

---

## Fase 4 — saas-client SDK (1 uge)

**Mål:** Kundens app kan installere SDK og se tokens live.

### `packages/saas-client/`

- [ ] `loadByApiKey(apiKey, options?)` — programmatisk fetch + apply
- [ ] Vue-plugin: `app.use(grundtone, { apiKey })`
- [ ] Script-tag auto-init: læser `data-api-key` fra current `<script>`-tag
- [ ] Bruger `applyThemeToDOM` fra `@grundtone/core` (ingen duplikering)
- [ ] Fejl-håndtering: ugyldig key, netværksfejl, 4xx/5xx fra CDN
- [ ] Cache-strategi: respektér ETag fra CDN

### Build + distribution

- [ ] Vite library mode → UMD + ESM bundles
- [ ] Bundle uploades til Bunny.net under `cdn.grundtone.io/client/v1.js` (UMD) og `v1.mjs` (ESM)
- [ ] Versions-strategi: `v1.js` (latest stable) + `v1.0.x.js` (immutable pinning)
- [ ] CI-step der publisher SDK ved tagged release

### Test-app

- [ ] `apps/studio/` har en `/preview/[projectId]`-side der bruger SDK'en mod ægte CDN
- [ ] Eat-your-own-dog-food: brug saas-client til at theme'e selve Studios login-side

**Demo-mål:** Lille statisk HTML-side med `<script data-api-key="...">` lyser op i kundens brand.

---

## Fase 5 — Polish + onboarding (1 uge)

**Mål:** Klar til betalende kunder (uden billing endnu).

### Onboarding-flow

- [ ] Signup → org-oprettelse → projekt-oprettelse → første token-edit → publish → install-snippet
- [ ] Install-snippets pr. framework (Vue, Nuxt, vanilla, React) i dashboardet
- [ ] "Hvad er en API-nøgle"-tooltip + dokumentation
- [ ] Tom-state for nye projekter med foreslåede defaults

### Rate limiting + sikkerhed

- [ ] CDN-niveau rate limit pr. `pk_live_...` (Bunny edge eller Nitro)
- [ ] Origin-check mod `allowed_origins`
- [ ] CORS-headers korrekt sat
- [ ] Sub-resource integrity for SDK-bundlen

### Operations

- [ ] Sentry EU-region eller GlitchTip self-hosted
- [ ] UpCloud monitoring + alerts (CPU, disk, db connections)
- [ ] Daglig backup-test (`pg_dump` restore i staging)
- [ ] Snapshot-script på VM (kør før deploy i prod)

### Dokumentation til kunder

- [ ] Integration-guides pr. framework
- [ ] Privacy policy + cookie-oplysning
- [ ] DPA-template kunder kan signe
- [ ] Sub-processor-liste

**Demo-mål:** En ekstern person kan signup uden hjælp og publish'e første tema på under 10 minutter.

---

## Fase 6 — Production launch (1 uge)

**Mål:** Fra staging til betalt produktion.

- [ ] Provisionér `studio-production-*` ressourcer (separat VM, separat DB, separat bucket)
- [ ] Opgrader Managed PostgreSQL til HA-plan
- [ ] DNS: `studio.grundtone.io` + `cdn.grundtone.io`
- [ ] GitHub Actions: deploy-workflow til staging på `develop`-branch, til prod på `main`-tags
- [ ] Smoke-tests post-deploy
- [ ] Status-page (statuspage.io eller upptime.dev)
- [ ] First customer onboarded manuelt

**Demo-mål:** Live betalt kunde med eget brand på CDN.

---

## Fase 7 — Post-MVP (prioriteret)

Kommer i denne rækkefølge, men hver kan scope-justeres:

1. **Stripe billing** — per-seat eller per-project, 14 dages trial
2. **Privat npm-distribution** — GitHub Packages som ekstra kanal til saas-client
3. **Image-upload + CDN-optimering** — hvis kunder vil servere logoer/grafik
4. **Diff mellem config-versioner** + visuel preview
5. **Audit log** — hvem ændrede hvad hvornår
6. **`@grundtone/nuxt-saas`** — SSR-modul til kunders Nuxt-sites
7. **React Native-support** i saas-client
8. **Custom domains pr. tenant** — Caddy/Traefik reverse-proxy
9. **Secret keys (`sk_live_...`)** + admin-API til CI/CD-publish
10. **Drag-drop sektion-builder** (skal valideres mod kundebehov først)
11. **Usage-analytics** + dashboard-metrics

---

## Tidsestimat

| Fase | Indhold                   | Varighed | Akkumuleret |
| ---- | ------------------------- | -------- | ----------- |
| 0    | Workspace + UpCloud-infra | 1 uge    | 1 uge       |
| 1    | Auth + multi-tenant       | 1 uge    | 2 uger      |
| 2    | Token editor + API keys   | 1 uge    | 3 uger      |
| 3    | Publish pipeline          | 1 uge    | 4 uger      |
| 4    | saas-client SDK           | 1 uge    | 5 uger      |
| 5    | Polish + onboarding       | 1 uge    | 6 uger      |
| 6    | Production launch         | 1 uge    | 7 uger      |

Solo-udvikler med fuld fokus: ~7 uger til betalbar produktion. Post-MVP er åbent.

---

## Tværgående spor (kører parallelt med faserne)

### Test-strategi

- **Fase 1+:** Vitest unit-tests for server-routes, validators
- **Fase 3+:** Integration-tests mod ægte Postgres + MinIO i CI
- **Fase 4+:** Playwright e2e mod Studio-app
- **Fase 5+:** Smoke-tests i CI mod staging post-deploy

### GDPR + compliance

- **Fase 0:** EU-only ressourcer (UpCloud + Bunny.net EU zones)
- **Fase 1:** Privacy policy + cookie-oplysning udkast
- **Fase 5:** DPA-template, sub-processor-liste, retention-policy
- **Fase 6:** User-delete-flow + data-export endpoint inden første kunde

### Open source-koordination

`@grundtone/saas-client` lever i Studio-repoet (privat), men SDK'en bruger `@grundtone/core`'s
`applyThemeToDOM` direkte. Det betyder:

- **Fase 4:** sikre at `applyThemeToDOM` er stabil (semver-major-bump hvis API ændres)
- Studio-repoet pinner præcis version af `@grundtone/core` for forudsigelig opførsel

---

## Åbne beslutninger fra MVP

Disse skal afklares undervejs (tabel fra MVP.md afsnit 11):

| Beslutning                                           | Senest afklares i                                 |
| ---------------------------------------------------- | ------------------------------------------------- |
| Email-provider (Postmark EU vs Scaleway)             | Fase 1                                            |
| Sentry-strategi (EU-region vs GlitchTip self-hosted) | Fase 5                                            |
| Origin-check-laget (Bunny.net edge vs Nitro-proxy)   | Fase 3                                            |
| Studio-licens (FSL vs ren privat)                    | Inden Fase 7 hvis nogen kunder beder om self-host |
