# Design note: standalone Studio with generic OIDC login and in-product roles

Status: proposal, for review. No code changes in this PR.

## Goal

A self-hosted Studio should need nothing but PostgreSQL and **any** OpenID Connect provider
(Keycloak, Authentik, Zitadel, Entra ID, Google, a future shared auth service, …):

1. Sign-in is a generic OIDC login. No provider-specific cookie or token exchange is required.
2. Studio **owns its roles**. Who may do what in an organisation is stored in Studio's database and
   assigned inside Studio. The identity provider (IdP) proves _who_ someone is; it never decides
   _what they may do_ unless an operator explicitly opts in to a claim mapping.
3. The existing Better Auth setup (`AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_INTERNAL_URL`,
   `AUTHORIZER=pdp|local`) keeps working unchanged as one supported provider mode.

## What exists today (measured on `main`)

- **Authentication** (`server/middleware/auth.ts`): reads the `better-auth.session_token` cookie,
  exchanges it at `{AUTH_ISSUER}/api/auth/token` for a JWT, verifies it against
  `{AUTH_ISSUER}/.well-known/jwks.json` (`server/lib/jwt.ts`: RS256 only, `iss`/`aud`/`exp`
  required). The actor is `{ sub, tenant (JWT claim "org"), email }`. `/api/auth/**` is a
  server-side proxy to the auth service (`server/api/auth/[...].ts`), and the browser uses the
  Better Auth client (`lib/auth-client.ts`).
- **Authorization** (`server/lib/authorizer.ts`): one interface, two implementations.
  `AUTHORIZER=local` decides from Studio's tables (`org_member`, `project_member`,
  `project_machine_grant`, `project.organizationId`); `AUTHORIZER=pdp` asks an external service.
- **What Studio does _not_ own.** There is no user table and no organisation table. Organisation
  name/slug, the member list, invitations and the active organisation live in the auth service
  (Better Auth organization plugin). Studio's organisation routes call that service and mirror the
  role into `org_member` ("two systems": `server/lib/org-membership.ts`, ~800 lines of ordering and
  rollback logic; `org-lookup.ts`; `org-member-sync.ts`). Users are only a `sub` string, with
  email/name denormalised into `project_member`.

**Consequence.** Replacing the login is the smaller half of the work. The larger half is that, in
standalone mode, Studio must own organisations, users and membership writes itself, because there is
no Better Auth organization API behind it.

## Design

### 1. Modes

`AUTH_MODE` selects the identity source per process:

| Value         | Meaning                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `better-auth` | Today's behaviour, unchanged. **Default when `AUTH_MODE` is unset and `AUTH_ISSUER` is set**, so existing deployments need no change.                            |
| `oidc`        | Generic OIDC login, Studio-owned sessions, Studio-owned organisations and membership. Requires `AUTHORIZER=local` (Studio refuses to start with `pdp` + `oidc`). |

`AUTH_MODE=oidc` does not touch the Better Auth code path; the two are selected at boot and covered
by separate tests. Cost of keeping Better Auth as a provider: low for login (the code is not
modified), moderate for the organisation layer (it stays dual-write in that mode only).

### 2. OIDC login: authorization code + PKCE

Configuration (all server-side; secret never exposed to the browser):

| Variable                      | Notes                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`                 | Issuer URL. Discovery at `{issuer}/.well-known/openid-configuration`. `https` required, `http` only for `localhost`/loopback. |
| `OIDC_CLIENT_ID`              | Required.                                                                                                                     |
| `OIDC_CLIENT_SECRET`          | Optional: omitted means a public client (PKCE only); set means confidential (`client_secret_basic`/`post` per discovery).     |
| `OIDC_SCOPES`                 | Default `openid email profile`. `offline_access` is never requested.                                                          |
| `OIDC_REDIRECT_URI`           | Default `{public origin}/api/oidc/callback`; must be registered at the IdP.                                                   |
| `OIDC_REQUIRE_EMAIL_VERIFIED` | Default `true`. See "User mapping".                                                                                           |
| `OIDC_ALLOWED_EMAIL_DOMAINS`  | Optional allowlist; empty means no restriction.                                                                               |
| `OIDC_JIT`                    | Default `on`: create the Studio user at first login. `off`: only pre-created users may sign in.                               |

Flow:

1. `GET /api/oidc/login?next=/path` fetches (and caches) discovery. The discovered `issuer` must
   equal `OIDC_ISSUER` exactly, otherwise Studio refuses to proceed. It generates `state`, `nonce`
   and a PKCE `code_verifier` (S256), stores them with the validated `next` in a short-lived (10
   min), `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/oidc` signed cookie, then redirects to
   `authorization_endpoint`. `next` must be a same-origin relative path (`/…`, not `//…`); anything
   else is dropped (open-redirect guard).
2. `GET /api/oidc/callback` checks `state` against the cookie (constant time), clears the cookie,
   rejects an `error` response, and exchanges `code` + `code_verifier` at `token_endpoint`.
3. The **ID token** is validated: signature against the IdP's JWKS (`jwks_uri`, cached, algorithm
   restricted to the asymmetric algorithms discovery advertises; `none` and HMAC refused), `iss`
   equals the configured issuer, `aud` contains `OIDC_CLIENT_ID` (and `azp` matches if several
   audiences), `exp`/`iat` within a small clock tolerance, `nonce` equals the stored nonce.
   Implementation uses `jose` (already a dependency) and, for the protocol steps, a maintained
   certified client library rather than hand-rolled protocol code.
4. Studio does **not** use the access token to call APIs and does not store it. It is validated only
   if the IdP returns an `at_hash` (then it is checked against the ID token). Machine access keeps
   using Studio's own API keys (`sk_…`), unchanged.
5. Required claims: `sub`. Used if present: `email`, `email_verified`, `name` (fallbacks
   `preferred_username`, then the local part of the email). If `email` is absent and
   `userinfo_endpoint` is advertised, one `userinfo` call fills it, and its `sub` must equal the ID
   token's `sub`.
6. On success Studio creates a session (below) and redirects to the validated `next`.

All failures return a generic error page and log a stable reason code (never tokens, codes or claim
values).

### 3. Sessions and cookies

Studio-owned, server-side sessions, so a disabled user or a role change takes effect on the next
request:

- Opaque 256-bit random token in the cookie; only its SHA-256 hash is stored (`session` table: hash,
  user id, active organisation id, created/last-seen/expires, optional `id_token` for logout hints).
- Cookie `__Host-studio_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`); on
  plain-HTTP `localhost` development the name and `Secure` flag are relaxed explicitly, never by
  sniffing proxies.
- A new token is issued at every login (no session fixation). Lifetime: idle 8 h, absolute 7 d, both
  configurable. Expired rows are purged by a Nitro task.
- State-changing routes keep the existing same-origin check (`assertSameOrigin`); `SameSite=Lax` is
  defence in depth, not the only CSRF control.
- The active organisation is a session attribute chosen in Studio, not a JWT claim.

### 4. Logout

`POST /api/oidc/logout` (same-origin checked): deletes the session row, clears the cookie, then if
discovery lists `end_session_endpoint` redirects there (RP-initiated logout) with `id_token_hint`,
`client_id` and `post_logout_redirect_uri` (a fixed, operator-registered `{origin}/`). If the IdP
has no end-session endpoint, logout is local only and the docs say so. Back-channel/front-channel
logout is out of scope for the first iteration.

### 5. User mapping

New tables (migration is additive):

- `app_user`: `id` (text, Studio's id), `email`, `email_verified`, `name`, `disabled_at`,
  `created_at`.
- `user_identity`: `(issuer, subject)` unique → `user_id`.

Rules:

- The identity key is `(issuer, sub)`. **Studio never links two identities because their e-mail
  addresses match**; that is an account-takeover primitive when an IdP does not verify e-mail.
- Existing data is keyed by the Better Auth `sub` (`org_member.userId`, `project_member.userId`,
  audit rows). To keep it valid with no data migration, in `better-auth` mode (and for the identity
  created for it) `app_user.id` equals that `sub`. In `oidc` mode new users get a generated id.
- E-mail is used for exactly one thing: matching a pending **invitation** to the person accepting
  it, and only when the IdP says `email_verified = true` (unless the operator turns
  `OIDC_REQUIRE_EMAIL_VERIFIED` off, which the docs flag as unsafe with multi-tenant IdPs).
- JIT creation gives a user **no access**: with no organisation membership every organisation and
  project check is denied. A user is therefore harmless until someone grants a role.

### 6. Studio-owned organisations (needed for standalone)

`organization` (id, name, slug, created_at) and `org_invitation` (org, e-mail, role, token hash,
expiry, invited_by) become Studio tables. In `oidc` mode, org create / list / lookup / invite /
accept / remove / role change write **only** to Studio's database (single transaction with the audit
row); the "write auth first / revoke first" ordering in `org-membership.ts` is not used there. In
`better-auth` mode nothing changes.

## Roles and permissions (from the code)

Roles are stored in `org_member` (one role per user per organisation), `project_member`, and
`project_machine_grant`. Verified against `server/lib/local-authorizer.ts`,
`server/lib/project-access.ts`, `composables/useOrgRoles.ts`.

**Organisation roles**, rank `billing < member < admin < manager < owner` (relations are separate:
owner does not _imply_ manager in the authorizer; `requireOrgRole` compares rank):

| Role      | May                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `owner`   | Everything below, plus change other owners (today: only via an out-of-band path; not assignable in the UI).       |
| `manager` | Manage org members (`canManageOrgMembers`), create projects, project **admin** on every project in the org.       |
| `admin`   | Create projects (`canCreateProjects`), **view** every project in the org. Not project admin/editor by role alone. |
| `member`  | **View** every project in the org.                                                                                |
| `billing` | Billing (`canManageBilling`, with owner). **No project access** (`canViewProjects` is false).                     |

Assignment rules today (`canAssignRole`/`canManageMember`): you may assign or change to a role
strictly below your own; only an owner may touch an owner or assign a peer rank.

**Project roles** (`project_member`): `viewer` < `editor` < `admin`. Computed access: `can_admin` =
project admin, or org owner/manager; `can_edit` = project editor, or `can_admin`; `can_view` =
project viewer, or `can_edit`, or org admin/member. Effective role is the maximum.

**Machine principals** (`project_machine_grant`): per-project secret keys, **editor only** (database
check constraint); never an org role; cannot raise their own rights.

Denial semantics to preserve: unknown role strings grant nothing (`org_member_role_known`
constraint), a malformed project id is denied, a database error is `unavailable` (503), never
`allowed`.

### What this design adds

- **Owner assignment inside Studio**, which Better Auth could not express: an owner may promote
  another user to owner (multiple owners allowed) and may demote an owner.
- **Last-owner protection**: removing, demoting, disabling or leaving as the last _enabled_ owner of
  an organisation is refused (checked inside the same transaction, with the organisation row locked
  so two concurrent requests cannot both succeed).
- **Tenant isolation**: every role read/write is scoped by `organization_id`; an actor's role in org
  A never answers a question about org B. Covered by tests before the code (see Slicing).

### First owner on a fresh self-host (no IdP groups, no open window)

There is deliberately **no** "first user to sign in becomes owner" window.

1. **Primary: operator CLI.**
   `pnpm studio admin create-org --slug acme --name "Acme" --owner-email you@example.com` (also
   runnable in the container). It needs database access, which is the operator's proof of authority.
   It creates the organisation and a **pending owner grant** for that e-mail.
2. The grant is consumed when someone signs in whose ID token has `email_verified = true` and the
   same e-mail (and, with `--owner-sub <sub>`, the same subject, for the strictest option). It is
   single-use, expires (default 7 days), and is audited.
3. **Container-friendly equivalent:** `STUDIO_BOOTSTRAP_OWNER_EMAIL` + `STUDIO_BOOTSTRAP_ORG_SLUG`
   create the same pending grant at boot **only if that organisation has no owner**. Once an owner
   exists the variables are ignored (and a warning is logged so they can be removed).
4. Recovery (all owners lost/disabled): the same CLI, `admin grant-owner`, run by the operator.

Organisation creation by ordinary users is governed by `ORG_CREATION=operator|users`. Proposed
default in `oidc` mode: `operator`, because a public or multi-tenant IdP would otherwise let any
account create organisations on someone else's instance. `better-auth` mode keeps today's behaviour.

### Optional IdP claim → role mapping (off by default)

Configured with `OIDC_ROLE_CLAIM` (e.g. `groups`) and an explicit map `OIDC_ROLE_MAP` =
`{"studio-admins": {"org": "acme", "role": "admin"}}`. Safest precedence:

1. **Local assignment always wins.** Every `org_member` row carries `source` = `local` | `claim`.
   Claims never create, change or delete a `local` row.
2. A claim may only **grant** where the user has no local row, creating a `claim` row, and only for
   organisations and roles named in the map. `owner` can never be granted by claim (config
   validation rejects it); a claim can reach at most `manager`.
3. A `claim` row is removed on the next login that no longer carries the claim (claims can only
   _reduce_ their own grants). If a Studio admin later assigns the same user a role locally, the row
   becomes `local` and the claim no longer affects it.
4. Mapping is opt-in (`OIDC_ROLE_MAP` unset = nothing happens) and every change is audited with its
   source.
5. A disabled user gets nothing from claims.

### Disabled users

`app_user.disabled_at` is checked **on every request** (fresh read, not cached in the session): a
disabled user is treated as unauthenticated, their sessions are deleted at the moment of disabling,
login is refused (generic message plus audit row), and API keys they created keep working (machine
principals are separate; the docs say to rotate them if needed). Role rows are kept so re-enabling
restores access. Disabled users do not count as owners for last-owner protection. Who may disable: a
user can belong to several organisations, so an organisation owner cannot disable the account.
Disabling is an **instance-operator** action (CLI `admin disable-user`); removing a member from one
organisation stays an organisation action.

## Implementation size and slicing

Honest estimate: **about 3.5–4.5k lines including tests**, 7 PRs, each independently mergeable and
green; `better-auth` mode is untouched by all of them.

| PR  | Content                                                                                                                                                | Size (approx.) |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 1   | This note                                                                                                                                              | docs only      |
| 2   | OIDC config validation, discovery, code+PKCE flow, ID-token validation, JIT user + identity tables (flow tests against a fake IdP, denial paths first) | ~900           |
| 3   | Sessions table, middleware for `AUTH_MODE=oidc`, cookie flags, logout (RP-initiated), disabled-user check                                              | ~600           |
| 4   | Studio-owned organisations/invitations, local-only membership writes in `oidc` mode (**largest; not in the original slicing**)                         | ~1100          |
| 5   | First-owner bootstrap: CLI + env grant, expiry, audit                                                                                                  | ~400           |
| 6   | Role assignment API/UI, owner transfer, last-owner protection; tenant/org isolation tests; optional claim mapping                                      | ~800           |
| 7   | Docs: README Authentication/Permissions rewrite, standalone-with-any-OIDC, connecting a shared auth service                                            | docs only      |

Tests lead each slice, starting with the denial and isolation paths: wrong `iss`/`aud`/`nonce`/
`state`, `alg: none`, replayed callback, open redirect in `next`, cross-org role read/write,
last-owner removal races, disabled-user requests, claim attempting to override a local role or to
grant `owner`.

## Decisions (confirmed by the maintainer)

1. `ORG_CREATION` defaults to `operator` in `oidc` mode.
2. Multiple owners and owner transfer are allowed in Studio.
3. `OIDC_REQUIRE_EMAIL_VERIFIED` defaults to `true`. IdPs that never send `email_verified` cannot
   accept e-mail-matched invitations or bootstrap grants; the operator pre-links by `--owner-sub`.
4. Password reset, change of e-mail and account deletion are the IdP's job in `oidc` mode. Studio
   keeps only local user-data deletion/export.

## Out of scope

Back-channel logout, SCIM provisioning, multiple simultaneous IdPs, refresh-token use, SAML.
