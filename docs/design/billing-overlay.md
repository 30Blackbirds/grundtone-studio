# Design note: payment-provider-neutral Studio with a private billing overlay

Status: proposal, 2026-11-18. Docs only; no code moves with this note. Decision owner: the project
owner. English.

## Goal

The public Studio (AGPL-3.0-only) must run without any payment provider and must not name one in its
code, UI strings or legal texts. The hosted service, which sells plans, adds billing as a **private
overlay on top of this one repository**. There is one codebase and no diverging fork.

Throughout, "overlay" means a private repository that depends on this one and adds code. It never
contains a copy of Studio.

## 0. Measured facts (2026-11-18, `main` at `162de265`)

- **No payment provider SDK or key is in this repo.** There is no `stripe` package in any
  `package.json`, no `STRIPE_*` or webhook-secret variable in `.env.example`, and no `from 'stripe'`
  import in the working tree or history (`git log -S"from 'stripe'"` finds nothing). All provider
  calls happen in a separate service, called **account**. Studio talks to it over HTTP with
  `ACCOUNT_URL` and `ACCOUNT_S2S_TOKEN`. Account is not in this repo.
- Studio sends only a plan key, an org id and a brand count across that boundary. Prices and
  provider ids live behind account.
- What _is_ public today and is SaaS-specific: the account client and relay, the billing pages, the
  plan catalog with euro prices, the entitlement checks keyed on account's answers, and provider
  names in copy.
- A switch already exists: `FEATURE_BILLING=on|off` (`runtime-flags.ts`). With `off`, billing routes
  answer 404, the reconcile task is a no-op, entitlements return `null`, and the provisioning
  feature is allowed. So the self-host path partly works today, but through nulls and flag checks
  scattered across call sites rather than through one interface.
- DB: no billing, subscription, invoice or price table exists. Tables touched by billing:
  `org_member.role` allows `billing`; `tenant_event_outbox` carries `tenantProvisioned` to account.

## 1. Inventory of billing touchpoints

Paths are under `apps/studio/`. "Callers" lists non-test code only.

### 1a. HTTP routes (`server/api/billing/`)

| File                           | What it does                                                                                                                                                                                                                                      | Called by                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `checkout-session.post.ts`     | Role-gated (`billing`), checks beta gate, provisions tenant at account, mints a user token, relays to account `POST /v1/billing/checkout-sessions`, returns a checkout URL. Body carries terms-accept proof, business attestation and VAT number. | `pages/plans.vue`                                      |
| `portal-session.post.ts`       | Same pattern; relays to account `POST /v1/billing/portal-sessions`; returns a portal URL.                                                                                                                                                         | `pages/orgs/[slug]/billing.vue`                        |
| `overview.get.ts`              | Reads subscription and invoice list from account's read mirror via `billing-read.ts`.                                                                                                                                                             | `pages/orgs/[slug]/billing.vue`                        |
| `entitlements-refresh.post.ts` | Busts the per-org entitlements cache after checkout success.                                                                                                                                                                                      | `pages/plans.vue`, billing page (return from checkout) |
| `server/api/features.get.ts`   | Reports `billing: boolean`.                                                                                                                                                                                                                       | `composables/useFeatures.ts`                           |

### 1b. Server libraries and tasks

| File                                                               | What it does                                                                                                                                                                                                                                                                            | Called by                                                                                                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/lib/entitlements.ts`                                       | HTTP client for account's entitlements API (60 s cache, stale up to 24 h), `evaluateProjectQuota`, `evaluateBrandQuota`, `evaluateProvisioningFeature`, `requireProvisioningFeature`, `PORTAL_KEY`. **Mixed file:** the quota and feature verdict logic is generic, the client is SaaS. | `brand-quota.ts`, `provisioning-auth.ts`, `api/projects.post.ts`, `api/orgs/[orgId]/projects.post.ts`, `api/orgs/[orgId]/provisioning-keys.post.ts`, billing routes |
| `server/lib/brand-quota.ts`                                        | `assertBrandCapacity` and `claimBrandSlot`: pre-check plus advisory-locked claim of an active-brand slot. Reads limits from entitlements and `hardCap` from the plan catalog. **Mixed:** the locking and counting are generic.                                                          | `api/projects/[projectId]/publish.post.ts`, `activate.post.ts`                                                                                                      |
| `server/lib/brand-count.ts`                                        | `countActiveBrands` use, `reportBrandCount` (PUT to account), `orgsWithBrands`. The report part is SaaS.                                                                                                                                                                                | publish and activate routes, checkout, reconcile task                                                                                                               |
| `server/tasks/billing/brand-count-reconcile.ts`                    | Daily Nitro task re-sending every org's brand count. Scheduled in `nuxt.config.ts` (`43 3 * * *`).                                                                                                                                                                                      | scheduler                                                                                                                                                           |
| `server/lib/billing-read.ts`                                       | Subscription and invoice read relay.                                                                                                                                                                                                                                                    | `overview.get.ts`                                                                                                                                                   |
| `server/lib/account-relay.ts`, `account-user-token.ts`             | S2S POST helper, dormant-503, user-token mint.                                                                                                                                                                                                                                          | checkout, portal                                                                                                                                                    |
| `server/lib/tenant-outbox.ts` (+ table `tenant_event_outbox`)      | Publishes `tenantProvisioned` to account so account has a company for the org.                                                                                                                                                                                                          | checkout (`provisionNow`), a scheduled run                                                                                                                          |
| `server/lib/beta-purchases.ts`, `server/plugins/beta-guard-log.ts` | Server-side closure of paid plans during beta (`BETA_MODE`).                                                                                                                                                                                                                            | checkout, portal                                                                                                                                                    |
| `server/lib/runtime-flags.ts`                                      | `FEATURE_BILLING` parsing and `requireBillingEnabled`.                                                                                                                                                                                                                                  | all billing routes, `features.get.ts`                                                                                                                               |
| `server/lib/org-request.ts`                                        | Gate `'billing'` (owner or billing role).                                                                                                                                                                                                                                               | billing routes                                                                                                                                                      |

### 1c. Catalog and UI

| File                                                              | What it does                                                                                                                                                                                          | Called by                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lib/plan-catalog.ts`                                             | Plan keys, euro prices, included brands, overage rates, features, `BETA_MODE`, account-key mapping, `CHECKOUT_PLAN_KEYS`. **Also holds `MAX_FONT_FILES_TOTAL`**, a product limit that is not billing. | `plans.vue`, `billing.vue`, `brand-quota.ts`, `checkout-session.post.ts`, `BrandAssetsSection.vue`, `tokens.ts` |
| `pages/plans.vue`                                                 | Pricing page and pre-checkout summary.                                                                                                                                                                | linked from `orgs/[slug]/index.vue`, `orgs/[slug]/projects/[projectSlug].vue`, billing page                     |
| `pages/orgs/[slug]/billing.vue`                                   | Subscription, invoices, portal button.                                                                                                                                                                | `AppSidebar.vue` (shown when `billingEnabled`)                                                                  |
| `components/AppSidebar.vue`, `composables/useFeatures.ts`         | Hide or show the billing link.                                                                                                                                                                        | layout                                                                                                          |
| `components/LegalProcessorsTable.vue`, `pages/sub-processors.vue` | Sub-processor table; `stripe` is one of six vendors.                                                                                                                                                  | legal pages                                                                                                     |
| `i18n/locales/{da,en}.json`                                       | Provider name in `plans.confirm.stripeNote`, `billing.updateViaStripe`, processor entry `stripe`, privacy and terms sections about payment data.                                                      | the pages above                                                                                                 |
| `assets/css/app.css`                                              | `/plans` styles.                                                                                                                                                                                      | `plans.vue`                                                                                                     |

### 1d. Strings that are not code paths

Comments naming the provider in `brand-count.ts`, `billing-read.ts`, `plan-catalog.ts`, the two
session routes, and `CLAUDE.md`. Two lines mentioning `pk_live_` or `pk_live` are about this
project's own API-key format and are **not** billing; they stay.

## 2. The public seam: an `Entitlements` interface

### 2a. Shape

One server-side interface answers "what may this org do", and nothing in the public code knows where
the answer comes from.

```ts
// apps/studio/server/lib/entitlements/types.ts (public)
export type PlanState = 'active' | 'grace' | 'suspended' | 'canceled'

export interface OrgEntitlements {
  planKey: string // opaque label for display only
  planState: PlanState
  graceUntil: string | null
  features: string[] // e.g. 'studio.provisioning_api'
  limits: Record<string, number> // absent key = unlimited
  asOf: string
}

export interface EntitlementsProvider {
  /** null = "unknown"; callers keep today's fail-open/fail-closed rules. */
  get(orgId: string): Promise<OrgEntitlements | null>
  invalidate?(orgId: string): void
  /** Called after an org's active-brand count changes. Default: no-op. */
  onBrandCountChanged?(orgId: string): Promise<void>
}
```

The type is today's `Entitlements` shape, kept on purpose: the verdict functions
(`evaluateProjectQuota`, `evaluateBrandQuota`, `evaluateProvisioningFeature`) and their tests stay
unchanged and become pure public code.

### 2b. Default self-host provider

- Reads limits from environment, for example `STUDIO_LIMIT_BRANDS`, `STUDIO_LIMIT_PROJECTS`. Unset
  means unlimited (absent key).
- Reports every feature enabled and `planState: 'active'`.
- Configuration lives in env and an optional YAML file, never a database table. No payment provider,
  no network call.
- This replaces the `billingEnabled()` early-outs in `entitlements.ts`, `brand-count.ts` and the
  reconcile task.
- One real behaviour difference to keep: the provisioning feature fails **closed** on `null`, quotas
  fail **open** on `null` (contract in `entitlements.ts`). The default provider never returns
  `null`, so a self-host install is never refused for lack of an answer.

### 2c. What stays public (and why)

- Quota enforcement: `brand-quota.ts` (locking, counting, 403 shape), the verdict functions,
  `MAX_FONT_FILES_TOTAL` (moved to a neutral `lib/limits.ts`), and the 403 codes. Self-hosters can
  set limits too.
- Role `billing` in `org_member` and the `billing` gate in `org-request.ts`: keep both. It is an
  org-role concept; the other session (see section 4) owns the role model. Note that a self-host
  install has no billing UI, so the role is simply inert there.
- A neutral "plan" display: the org page may show `planKey` as a label if a provider supplies one;
  it shows nothing for the default provider.
- `/api/features`: keep, but reshape to `{ billing: boolean }` driven by whether an overlay
  registered a billing surface (see 3b), not by a flag the operator must remember to set.

### 2d. What leaves the public tree

Everything in section 3. After the move the public tree contains no payment-provider name, no price,
and no call to account.

## 3. The private overlay

### 3a. What moves

| Moves to the overlay                                                                                                                                      | Public replacement                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `server/api/billing/*` (checkout, portal, overview, refresh)                                                                                              | none; routes are absent in self-host                                             |
| `server/lib/billing-read.ts`, `account-relay.ts`, `account-user-token.ts`, the HTTP half of `entitlements.ts`, `reportBrandCount`                         | the `EntitlementsProvider` implementation in the overlay                         |
| `server/tasks/billing/brand-count-reconcile.ts` and its `scheduledTasks` entry                                                                            | overlay's own `nuxt.config` adds it                                              |
| `lib/plan-catalog.ts` prices, overage, `BETA_MODE`, account-key map                                                                                       | `lib/limits.ts` keeps only `MAX_FONT_FILES_TOTAL`                                |
| `pages/plans.vue`, `pages/orgs/[slug]/billing.vue`, `/plans` CSS                                                                                          | public org pages stop linking to `/plans` unless a billing surface is registered |
| `beta-purchases.ts`, `beta-guard-log.ts`                                                                                                                  | gone from public                                                                 |
| provider copy in `da.json` / `en.json`, the `stripe` entry in `LegalProcessorsTable.vue` and `sub-processors.vue`, payment sections of terms/privacy text | public legal pages show the processors the **operator** configures               |
| `tenant-outbox.ts` + `tenantProvisioned`                                                                                                                  | moves with the overlay (decided: SaaS-only, see section 8)                       |

### 3b. How the overlay plugs in (one repo, no fork)

Use Nuxt's own layering, which exists for exactly this and requires no patching of public files.

1. **Overlay is a Nuxt layer in a private repo.** Nuxt merges `pages/`, `components/`,
   `server/api/`, `server/tasks/`, `server/plugins/`, `i18n` messages, `app.config` and
   `nuxt.config` from layers. The overlay therefore adds billing routes and pages without touching a
   public file.
2. **Studio is consumed at a pinned commit, not copied** (measured in B5, 2026-11-19). The build
   checks out Studio at the commit in the overlay's `STUDIO_REF` file and places the overlay at
   `apps/studio/layers/cloud`, where Nuxt registers it as a layer automatically. Studio's own
   lockfile, Dockerfile and boot-smoke then build the hosted image unchanged. Bumping the pin is a
   normal PR in the overlay repo.
   - `extends: ['github:…/apps/studio#ref']`, the form first proposed here, does **not** work:
     Studio depends on the private workspace package `@grundtone-studio/dtcg`, which a fetch of the
     one folder cannot resolve, and Studio's pnpm overrides would not apply to an outside install.
   - The overlay adds no dependencies of its own; everything it imports is already a Studio
     dependency. Studio's `.gitignore` ignores `apps/studio/layers/`.
   - Measured on a probe layer and then on the real one: routes, Nitro plugins and tasks, cron
     entries, pages, i18n messages and `app.config` arrays all merge. Arrays are appended after
     Studio's own entries, so the payment processor is now listed last on the legal pages.
3. **Extension points the public core must expose** (this is the real work and the reason for
   slicing in section 4):
   - a Nitro plugin hook or `useRuntimeConfig` key selecting the `EntitlementsProvider` (default:
     self-host provider);
   - a **navigation registry** so the sidebar shows "Billing" only when a layer registered an item,
     replacing the `billing` flag;
   - a **legal-processors registry** so the sub-processor table is data a layer can extend;
   - the brand-count-changed hook called from publish and activate (today `reportBrandCount` is
     called inline in both routes).
4. **Repository.** `30Blackbirds/grundtone-studio-cloud`, private, created 2026-11-18. B5 adds
   `server/` for the provider, billing routes, plugins and tasks, `pages/` for billing and plans,
   `i18n/` for provider copy, `app.config.ts` for its registry entries, and a verify workflow.
5. **Unused features cost nothing.** Without the overlay, none of the billing code exists in the
   build, so the self-host image has no dormant billing path.

### 3c. CI and releases of the overlay

- The overlay repo has its own CI (`verify.yml`): Studio at `STUDIO_REF`, the overlay at
  `apps/studio/layers/cloud`, then typecheck, lint, the overlay's tests, Studio's tests with the
  overlay present, the image build, Studio's boot-smoke with `FEATURE_BILLING=on`, and a check that
  the image refuses an invalid `FEATURE_BILLING`. A scheduled job against Studio `main` is still to
  come.
- Public repo CI never sees overlay code. It runs a contract test that the extension points still
  exist (a small fixture layer that registers a fake provider, nav item and processor).
- Releases: overlay builds its own image `FROM` the public release or consumes the pinned tag at
  build time, then deploys. Public release tags (`v*`, signed by cosign in `build.yml`) stay
  unchanged; the overlay image is signed by the overlay repo's own workflow.
- Public `build.yml` contains a `deploy-staging` job for the hosted service (see the publication
  findings note). That job belongs in the overlay or the operator's infra repo, not here. Out of
  scope for this note; flagged only.
- **No hosted deployment exists today** (owner, 2026-11-19): Studio runs only locally, through Tilt,
  with `FEATURE_BILLING=off`. So B5 has no deployment order to respect, and the public half can
  merge on its own. When a hosted service is set up, it builds its image from the overlay
  (`verify.yml` already builds and smokes that image, but pushes nothing); signing, pushing and
  deploying it are decided then.

## 4. Migration order, slices, and sequencing with studio-oidc-roles

Another session (studio-oidc-roles) is changing orgs, roles and auth in this repo, in slices after
PR #411. Billing code reads org and role data (`requireOrg(..., 'billing')`, `org_member.role`,
`canManageBilling`), so the seams below must not be cut while those files move.

**Proposal:** start slice B1 only **after the local-orgs slice of studio-oidc-roles has merged.**
Reasons: (1) it settles where orgs and the `billing` role live for a self-host install; (2)
`org-request.ts` and `org-membership.ts` are the two files both efforts touch; (3) slices B1 to B3
below do not need them, but B4 and later do. Slices B0 and B1 can run earlier only if they leave
`org-request.ts`, `org-membership.ts`, `schema/studio.ts` and `pdp.ts` alone. Confirm with that
session before starting.

Each slice is one small PR with green local tests and no behaviour change for the hosted service
until B5.

| #   | Slice                                                                                                                                                                                                                                           | Touches                                                         | Needs from oidc-roles                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| B0  | This note                                                                                                                                                                                                                                       | `docs/design/`                                                  | nothing                                            |
| B1  | Introduce `EntitlementsProvider` and the self-host provider; wrap the existing HTTP client as the "account" provider selected by `ACCOUNT_URL`; keep `FEATURE_BILLING` working                                                                  | `server/lib/entitlements*`                                      | nothing                                            |
| B2  | Move `MAX_FONT_FILES_TOTAL` to `lib/limits.ts`; split `plan-catalog.ts` into limits (public) and catalog (stays for now)                                                                                                                        | `lib/`, `tokens.ts`, `BrandAssetsSection.vue`                   | nothing                                            |
| B3  | Replace inline `reportBrandCount` calls with a `brandCountChanged` hook (`server/lib/brand-hooks.ts`); keep behaviour. The first-served hook for the outbox is deferred to B4: it lives in `org-lookup.ts`, which studio-oidc-roles is changing | publish, activate, `brand-count.ts`                             | nothing                                            |
| B4  | Navigation registry and legal-processors registry; sidebar and legal table read them; billing link registered by existing code                                                                                                                  | `AppSidebar.vue`, `LegalProcessorsTable.vue`, `features.get.ts` | **local-orgs slice landed** (sidebar and org gate) |
| B5  | Stand up the private overlay repo; copy-then-delete: overlay gets routes, task, pages, catalog with prices, relay, provider copy; public tree drops them in the same release                                                                    | many; see 3a                                                    | B4                                                 |
| B6  | Neutral copy: remove provider names from public locales, comments and `CLAUDE.md`; processors table driven by registry                                                                                                                          | `i18n`, comments                                                | B4                                                 |
| B7  | Tests: contract fixture layer; delete moved tests from public                                                                                                                                                                                   | `tests/`                                                        | B5                                                 |

B5 is the only slice with a hosted-service rollout risk. It ships as one coordinated release of the
public tag plus the overlay.

## 5. Data and database

- **No billing tables exist**, so there is nothing to move out of the public schema. Subscriptions,
  invoices and prices live in account.
- `org_member.role` keeps the value `billing`. Existing migrations (`0003`, `0015`) are history and
  are not edited. Any change to roles belongs to studio-oidc-roles.
- `tenant_event_outbox` (migration `0014`) was created for account and is SaaS-only (decided, see
  section 8). The table stays in the public schema as harmless history; a new migration may drop it
  later, never an edit of `0014`. Overlay-owned tables, if ever needed, live in the overlay's own
  migration folder with their own journal and a table-name prefix, so two migration sets never share
  a sequence.
- Self-host needs **no** new table: limits come from env or file.

## 6. Licence and contributor basis

**Measured (2026-11-18):**

- `LICENSE` is the GNU AGPL v3; `package.json` and `apps/studio/package.json` say `AGPL-3.0-only`.
- There is **no CLA and no DCO**: no `CLA`, `DCO`, `NOTICE` or `AUTHORS` file, and
  `CONTRIBUTING.md`, the PR template and `README.md` do not ask for a sign-off or an assignment.
- Authorship on `main` (397 non-merge commits in total): 348 by the project owner under four author
  or email identities, 49 by `dependabot[bot]`, and none by any other human author. All 264
  human-authored merged PRs are from the owner's account; the remaining 103 are Dependabot's.
  GitHub's contributors API lists the same two accounts.
- `Co-authored-by` trailers name the owner (own aliases), Dependabot, and AI tools (Claude, Cursor,
  Copilot). The tools' output is not a separate human copyright holder in this analysis, but see
  "Unknown".
- Dependabot commits change dependency manifests and lockfiles, not product code.

**Reading:** every human-authored line in the public core is the project owner's. As sole copyright
holder the owner may also license that code on other terms, and the overlay is separate code that
links to it; a private overlay is possible. The overlay must not copy AGPL code out of other
people's contributions, and the owner's own code can be both public (AGPL) and used in a private
deployment.

**Unknown, not measured:**

- **The vendored `server/vendor/permissions-client`** (generated code with a "Copyright 2026
  KlangHaus" header) has no licence file in the tree. Who holds that copyright and under what terms
  is not stated. It is a blocker for a clean AGPL claim over the whole repo and is already noted in
  the publication findings. Not part of billing.
- Whether any commit was authored by someone with a different employer or contract (the older
  address `allan@klanghaus.dk` appears twice); the git data cannot show it.
- Third-party fonts and other bundled assets were not audited.
- Copyright status of AI-assisted portions: a legal question, not decided here. Legal review is
  parked; no company is named.

**Before accepting any external PR**, add a DCO (`Signed-off-by`) or a CLA that grants the right to
relicense. Without it, an external contribution to the public core is AGPL-only and would limit the
owner's ability to relicense that part. Recommendation: **CLA**, because the stated goal is a
proprietary overlay and a possible dual licence. See section 8: the principle is adopted, no legal
text is written yet, and `CONTRIBUTING.md` says external PRs wait for it.

AGPL note for the overlay: the overlay is a separate work that extends the AGPL core. If the hosted
service offers the combined work over a network, the AGPL's source-offer duty applies to the
**public core** including any modifications of it; the overlay's own source is not covered _only if_
it is a separate work and not a derivative of core code. A Nuxt layer that merges files into the
core's build is closer to the line than a service behind an API. This needs a legal read before the
overlay ships. It is the owner who is the licensor of both sides, which removes the conflict for
code the owner wrote.

## 7. Risks

1. **History is public.** Billing code, price points, comments naming the provider, and Danish
   internal rationale already live in the public history and the 135 remote branches. Moving code
   forward does not hide it. Treat everything in section 1 as published. Rewriting history is not
   proposed: it breaks forks and signatures and gains little for plan prices that are on a public
   pricing page anyway.
2. **Keys.** Measured: no provider keys or webhook secrets appear in the tree or `.env.example`;
   `ACCOUNT_S2S_TOKEN` is read from env and not committed. Measured 2026-11-18: Gitleaks 8.30.1 over
   627 commits (all refs in a fresh clone) found no leaks with the repo's own config. With the
   default ruleset only it reports 2 `generic-api-key` hits, both in the historical `docs/MVP.md` (a
   fake install-snippet publishable key, already allowlisted). Gitleaks matches known key formats
   and entropy, so a plain unformatted token value would not be caught.
3. **Sub-processor and legal texts.** The public `sub-processors` page and terms name a payment
   provider. After the move, the public page must list only what the operator configures; the hosted
   service's list lives in the overlay. The existing legal texts are the hosted service's own and
   must not describe the public software. Do not name any company in public text.
4. **Layer fragility.** Nuxt layers merge by file path. A renamed public page or API route silently
   stops overriding. Mitigated by the contract fixture in B7 and the scheduled overlay build against
   `main`.
5. **Fail-open versus fail-closed drift.** Quotas fail open, the paid feature fails closed. The
   default provider must keep both rules testable; do not unify them.
6. **Collision with studio-oidc-roles** on `org-request.ts`, `org-membership.ts` and the sidebar.
   Hence the sequencing in section 4.
7. **A dormant public billing flag is not a substitute for the move.** `FEATURE_BILLING=off` hides
   the surface but leaves the code, the copy and the prices public.
8. **Account contract.** The overlay depends on account's API shape; a change there now breaks the
   overlay build, not the public core. This is the intended direction.

## 8. Decisions

Decided by the project owner on 2026-11-18 (relayed by the PM session):

1. **Contributor basis:** the principle is adopted: **a CLA before the first external PR** to the
   public core. No legal text is written, because legal is parked and the project name is a working
   name with no company behind it. `CONTRIBUTING.md` states only that external PRs wait for a CLA.
2. **Overlay repository:** approved and created as a private repository (see section 3b, item 4).
3. **`tenant_event_outbox` / `tenantProvisioned`:** SaaS-only. It moves with the overlay. The public
   core gets a small first-served extension point instead (B4, after studio-oidc-roles has changed
   `org-lookup.ts`).

Sequencing: slices B1 to B4 are merged (PRs 417, 421, 420, 428). B5 is two PRs: the public one that
drops billing and the overlay's that adds it. With no hosted deployment (section 3c), they need not
land in a particular order; after the public one merges, the overlay's `STUDIO_REF` moves to its
merge commit.

Left public by B5, on purpose:

- `server/api/lifecycle/tenant-state.post.ts` (account suspends or reactivates an org). It is not in
  the move list in 3a, it is dormant without `LIFECYCLE_S2S_TOKEN`, and suspension is enforced by
  public code (`org_suspension`, the `/k` grace). Whether it moves is an open question.
- Legal text that names the payment processor: privacy `s23data` and `s5p`, terms `s5p3`. B6
  (2026-11-19) neutralised the rest of the public copy and comments but left these three on the
  owner's decision: legal is parked, and changing them is legal work. They are taken up when legal
  is, either reworded in the public tree or overridden by the overlay's locale files.
