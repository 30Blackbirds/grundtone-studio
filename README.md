<div align="center">

# Grundtone Studio

**Configure your Grundtone design system in a web UI, and ship the result to every app that uses
it.**\
Multi-tenant, self-hostable, open source.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

[grundtone.dev](https://grundtone.dev) ·
[Grundtone design system](https://github.com/30Blackbirds/grundtone) ·
[Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

</div>

---

Grundtone Studio is the management layer for [Grundtone](https://github.com/30Blackbirds/grundtone)
design systems. Organisations create projects (design-system instances), edit design tokens,
colours, fonts and logos in a web UI, publish a version, and every consuming app picks it up through
a small runtime SDK and an API key.

A hosted version of Studio is offered separately at [grundtone.dev](https://grundtone.dev). This
repository is the code you can run yourself.

## Features

- **Sign in with any OpenID Connect provider** (Keycloak, Authentik, Zitadel, Entra ID, Google, …)
  or connect a central [Better Auth](https://better-auth.com) service instead.
- **Roles owned by Studio**: organisation roles (owner, manager, admin, member, billing) and project
  roles (admin, editor, viewer) are stored and assigned in Studio, with invitations. The identity
  provider proves who someone is; it decides nothing about access unless you opt in.
- **Token editor** for colours, typography, spacing and logos, with draft, publish and activate.
- **CDN-style delivery**: published tokens are served at `/k/<key>/tokens.json` and
  `/k/<key>/tokens.css`, and the runtime SDK at `/client/v1.js`. Put any CDN in front.
- **[`@grundtone/saas-client`](./packages/saas-client)**: the runtime SDK that applies tokens as CSS
  variables in Vue, Nuxt, React or plain HTML.
- **[DTCG](./packages/dtcg) import and export** of tokens (Design Tokens Community Group format).
- **[`tokens-cli`](./packages/tokens-cli)**: a headless CLI for managing project tokens with a
  per-project secret key.
- **Audit log**, machine API keys and per-project machine grants.
- English and Danish UI (`apps/studio/i18n`).

## Table of contents

- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Self-hosting](#self-hosting)
- [Authentication](#authentication)
- [Permissions](#permissions)
- [Error monitoring (Sentry, optional)](#error-monitoring-sentry-optional)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Related repositories](#related-repositories)

## Prerequisites

| Tool                | Version                                                               |
| ------------------- | --------------------------------------------------------------------- |
| Node.js             | `26.13.1` (see [`.nvmrc`](./.nvmrc)); `engines` requires >=26.13.1    |
| pnpm                | `10.14.0` (the `packageManager` field; `corepack enable` installs it) |
| Docker with Compose | for PostgreSQL and MinIO locally, and for the production image        |
| GNU Make (optional) | for the `make` shortcuts                                              |

## Quickstart

Run Studio on your machine with a local PostgreSQL and no external services. Sign-in is replaced by
a **development-only bypass** that is refused outside `NODE_ENV=development` and only works on
loopback.

```bash
git clone https://github.com/30Blackbirds/grundtone-studio.git
cd grundtone-studio
corepack enable
pnpm install --frozen-lockfile
cp apps/studio/.env.example apps/studio/.env
```

Edit `apps/studio/.env` and set:

```bash
AUTHORIZER=local
STUDIO_DEV_AUTH_BYPASS=1
```

Then start PostgreSQL and MinIO, migrate, seed and run the dev server:

```bash
HOST=127.0.0.1 NODE_ENV=development make dev
```

`make dev` runs `docker compose up -d` in `apps/studio` (PostgreSQL on `54320`, MinIO on `9000` and
`9001`), applies the Drizzle migrations, seeds a demo organisation and project, and starts Nuxt on
<http://localhost:3000>. Check it with `curl http://localhost:3000/api/healthz`. Run `make help` for
the other targets (`make stop`, `make reset`, `make test`, ...).

> The dev bypass hands out an admin session, so Studio refuses to start with it unless it listens on
> loopback. Never set `STUDIO_DEV_AUTH_BYPASS` anywhere else; a production build refuses to boot
> when it is present.

## Self-hosting

### How the pieces fit

Studio is a Nuxt 3 (Nitro) app. It stores data in **PostgreSQL** (Drizzle ORM; migrations run
automatically when the container starts) and files in **S3-compatible object storage**. It is
deliberately thin on identity and access:

| Concern              | How Studio does it                                                                                                                                                                                                                                                                                                                                       | Self-hoster's choice                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Authentication**   | Two modes, chosen with `AUTH_MODE`. `oidc`: Studio signs people in with any OpenID Connect provider and keeps its own users, sessions and organisations. `better-auth` (the default): a separate Better Auth service owns users and organisations, and Studio verifies its tokens. Studio never stores passwords. See [Authentication](#authentication). | Use `AUTH_MODE=oidc` with the identity provider you already run.                                      |
| **Permissions**      | Every access decision goes through one interface (`server/lib/authorizer.ts`). `AUTHORIZER=local` decides from Studio's own database (`org_member`, `project_member`, `project_machine_grant`). `AUTHORIZER=pdp` asks an external permissions service over Connect-RPC (`PERMISSIONS_URL`, `PDP_S2S_TOKEN`). See [Permissions](#permissions).            | Use `AUTHORIZER=local`. It needs nothing beyond PostgreSQL, and `AUTH_MODE=oidc` requires it.         |
| **Notifications**    | Studio sends one kind of e-mail: invitations to organisations and projects, over SMTP with nodemailer. With `SMTP_HOST` empty, they are printed to the server log instead of sent. Signing in never needs e-mail from Studio; account e-mails (verification, password reset) are the identity provider's or auth service's job.                          | Point `SMTP_*` at any SMTP relay, or leave it empty and copy invitation links from the log.           |
| **Plans and limits** | Studio has no billing. Every organisation has every feature; `STUDIO_LIMIT_BRANDS` and `STUDIO_LIMIT_PROJECTS` cap active brands and projects per organisation (unset = unlimited). A Nuxt layer can install its own entitlements provider (`server/lib/entitlements.ts`).                                                                               | Leave the limits unset, or set them to cap usage.                                                     |
| **CDN**              | Studio serves published tokens itself under `/k/...` and `/client/...`. If `BUNNY_PURGE_API_KEY` is set it purges a Bunny.net CDN on publish; empty disables this.                                                                                                                                                                                       | Leave `BUNNY_PURGE_API_KEY` empty, or put your own CDN in front and set `NUXT_PUBLIC_CDN_BASE` to it. |

> **Fully self-contained:** `AUTH_MODE=oidc` and `AUTHORIZER=local` need nothing beyond PostgreSQL,
> S3-compatible storage and an OpenID Connect provider. SMTP is optional.

### 1. Build the image

The production compose file references a container image from this project's registry. Build your
own from the repository instead, and edit the `image:` line in `docker-compose.production.yml` to
point at it:

```bash
docker build -t grundtone-studio:local .
```

### 2. Configure

Create `.env.production` next to `docker-compose.production.yml`. Compose reads `IMAGE_TAG` and
`DOMAIN` from it, and the container reads everything else.

```bash
IMAGE_TAG=local
DOMAIN=studio.example.com
```

Environment variables (defaults and full commentary live in
[`apps/studio/.env.example`](./apps/studio/.env.example)):

| Variable                                       | Required              | Purpose                                                                                                  |
| ---------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `IMAGE_TAG`, `DOMAIN`                          | yes                   | Read by Compose: the image tag to run and the public hostname Caddy serves.                              |
| `DATABASE_URL`                                 | yes                   | PostgreSQL connection string. Use `?sslmode=require` for managed databases.                              |
| `AUTHORIZER`                                   | yes                   | `local` or `pdp`. No default; Studio refuses to start without it.                                        |
| `STUDIO_LIMIT_BRANDS`, `STUDIO_LIMIT_PROJECTS` | no                    | Per-organisation caps on active brands and projects. Unset means unlimited.                              |
| `AUTH_MODE`                                    | no                    | `oidc` or `better-auth` (default). See [Authentication](#authentication).                                |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`                | with `oidc`           | Your identity provider and the client registered there.                                                  |
| `OIDC_CLIENT_SECRET`, other `OIDC_*`           | no                    | Client secret (omit for a public client) and the options listed under [Authentication](#authentication). |
| `AUTH_ISSUER`                                  | with `better-auth`    | Base URL of the auth service. Also the JWT issuer and JWKS source.                                       |
| `AUTH_AUDIENCE`                                | with `better-auth`    | JWT audience Studio accepts. By convention equal to `AUTH_ISSUER`.                                       |
| `AUTH_INTERNAL_URL`                            | no                    | Server-side address of the auth service when `AUTH_ISSUER` is not reachable from the container.          |
| `NUXT_PUBLIC_AUTH_URL`                         | with `better-auth`    | Browser-facing base URL for auth requests (typically Studio's own origin).                               |
| `ORG_WRITE_SERVICE_SECRET`                     | with `better-auth`    | Shared secret (at least 32 bytes) for organisation-membership writes; same value on the auth service.    |
| `NUXT_PUBLIC_APP_URL`                          | yes                   | Studio's public URL, used in invitation links and, in `oidc` mode, for the callback URL.                 |
| `NUXT_PUBLIC_CDN_BASE`                         | yes (prod)            | Base URL the install snippets point at. The app refuses to start in production without it.               |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`        | yes                   | S3-compatible storage for logos, fonts and published tokens.                                             |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`     | yes                   | Credentials for that bucket.                                                                             |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`        | no                    | Outgoing e-mail. Empty `SMTP_HOST` logs e-mails instead of sending them.                                 |
| `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`     | no                    | SMTP credentials and the sender address.                                                                 |
| `PERMISSIONS_URL`, `PDP_S2S_TOKEN`             | with `AUTHORIZER=pdp` | External permissions service and its service token.                                                      |
| `ACCOUNT_DELETED_WEBHOOK_SECRET`               | no                    | `better-auth` mode: secret for the account-deletion webhook the auth service calls.                      |
| `IDENTITY_EXPORT_SERVICE_SECRET`               | no                    | `better-auth` mode: secret for the GDPR data-export call to the auth service.                            |
| `BUNNY_PURGE_API_KEY`                          | no                    | Bunny.net CDN purge on publish. Leave empty if you do not use Bunny.                                     |
| `NUXT_PUBLIC_SENTRY_DSN`                       | no                    | Sentry error reporting. Empty disables it.                                                               |

Create the S3 bucket before the first start. Studio does not create it.

### 3. Run

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d
curl https://studio.example.com/api/healthz
```

The compose file runs the Studio container and [Caddy](https://caddyserver.com) as a reverse proxy.
The [`Caddyfile`](./Caddyfile) proxies `{$DOMAIN}` to the app on port 3000, enables gzip and zstd,
sets security headers (HSTS, `X-Frame-Options: DENY`, ...) and obtains a TLS certificate
automatically. PostgreSQL is **not** part of this compose file; run it yourself or use a managed
database. Using another reverse proxy works too: forward to the container's port 3000 and set
`X-Forwarded-*` headers.

### Upgrading

Change `IMAGE_TAG` (or rebuild your image) and run the same `up -d` command. The entrypoint applies
pending database migrations before the server starts. Read [`CHANGELOG.md`](./CHANGELOG.md) first.

### Backups

State lives in two places: the PostgreSQL database and the S3 bucket. Back up both, for example
`pg_dump "$DATABASE_URL" > studio.sql` and a bucket sync with your storage provider's tooling.
Restore by loading the dump into an empty database and restoring the bucket.

## Authentication

`AUTH_MODE` picks where people sign in. In `oidc` mode Studio checks its settings at startup and
refuses to start when one is missing or invalid.

### Standalone: any OpenID Connect provider (`AUTH_MODE=oidc`)

Studio signs people in with the authorization code flow and PKCE, and keeps its own users, sessions,
organisations and roles in PostgreSQL. The identity provider (IdP) only proves who someone is.

1. **Register a client at your IdP.** Redirect URI: `https://studio.example.com/api/oidc/callback`.
   Post-logout redirect URI: `https://studio.example.com/`. Scopes: `openid email profile`. A
   confidential client (with a secret) and a public client (PKCE only) both work.
2. **Configure Studio** in `.env.production`:

   ```bash
   AUTH_MODE=oidc
   AUTHORIZER=local
   NUXT_PUBLIC_APP_URL=https://studio.example.com
   OIDC_ISSUER=https://idp.example.com/realms/main
   OIDC_CLIENT_ID=grundtone-studio
   OIDC_CLIENT_SECRET=...
   ```

   `OIDC_ISSUER` must be exactly the `issuer` your IdP publishes at
   `{OIDC_ISSUER}/.well-known/openid-configuration`, and must be `https` (plain `http` is accepted
   for `localhost` only).

3. **Sign in once.** The first sign-in creates a Studio user with **no access**: nobody gets a role
   by signing in, and there is no "first user becomes admin" window.
4. **Make the first owner** with the operator command, which needs database access and nothing else:

   ```bash
   docker compose -f docker-compose.production.yml --env-file .env.production exec app \
     node --import tsx server/db/bootstrap-owner.ts --sub <subject> --org acme --name "Acme"
   ```

   `<subject>` is the person's `sub` at the IdP (shown in most IdPs' user details, or afterwards by
   `select issuer, subject from user_identity;`). `--name` creates the organisation when it does not
   exist. The person does not have to have signed in yet. The command is idempotent and is also the
   way back in when every owner is gone. `--email <address>` instead of `--sub` works too: an
   existing user with that address becomes owner, otherwise a one-use invitation link is printed.
   Prefer `--sub`, because it does not depend on who controls an e-mail address.

5. **Invite everyone else** from the organisation's member page. The owner assigns roles in Studio.

| Variable                           | Default                                   | Notes                                                                                                 |
| ---------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`                      | required                                  | Issuer URL, compared exactly.                                                                         |
| `OIDC_CLIENT_ID`                   | required                                  |                                                                                                       |
| `OIDC_CLIENT_SECRET`               | none                                      | Omit for a public client.                                                                             |
| `OIDC_SCOPES`                      | `openid email profile`                    |                                                                                                       |
| `OIDC_REDIRECT_URI`                | `{NUXT_PUBLIC_APP_URL}/api/oidc/callback` | Must be registered at the IdP. The route stays `/api/oidc/callback`.                                  |
| `OIDC_ID_TOKEN_ALG`                | `RS256`                                   | The one ID-token signing algorithm accepted.                                                          |
| `OIDC_REQUIRE_EMAIL_VERIFIED`      | `true`                                    | See below before changing it.                                                                         |
| `OIDC_ALLOWED_EMAIL_DOMAINS`       | none                                      | Comma-separated allowlist; empty means no restriction.                                                |
| `OIDC_JIT`                         | `on`                                      | `off`: only users created beforehand (for example with `bootstrap-owner --sub`) may sign in.          |
| `OIDC_SESSION_IDLE_HOURS`          | `8`                                       | A session ends after this long without a request.                                                     |
| `OIDC_SESSION_MAX_DAYS`            | `7`                                       | A session ends after this long, however active.                                                       |
| `ORG_CREATION`                     | `operator`                                | `operator`: organisations come from the command above only. `users`: anyone signed in may create one. |
| `OIDC_ROLE_CLAIM`, `OIDC_ROLE_MAP` | none                                      | Optional roles from the IdP; see below.                                                               |

**E-mail verification.** Studio sends no verification e-mail; it trusts the IdP's `email_verified`
claim. Studio uses an address for two things: matching an invitation to the person accepting it, and
`OIDC_ALLOWED_EMAIL_DOMAINS`. With `OIDC_REQUIRE_EMAIL_VERIFIED=true`, an unverified address never
matches an invitation. Setting it to `false` means that **anyone who can register an address at your
IdP can accept a pending invitation sent to that address.** Do that only with an IdP whose sign-up
is closed or controlled. Studio never links two sign-ins because their e-mail addresses match: a
person is identified by issuer and subject.

**Signing out.** The sign-out in Studio's menu ends Studio's session only. Your IdP's own session
stays, so the IdP may sign the person straight back in. Studio's logout route,
`POST /api/oidc/logout`, also sends the browser to the IdP's end-session endpoint when the IdP
publishes one, but the menu does not use it yet.

**Removing access at once.** Removing someone from an organisation takes effect on their next
request. To lock a person out of Studio entirely, in every organisation, disable the user with the
operator command:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production exec app \
  node --import tsx server/db/user-access.ts disable --sub <subject>
```

Their sessions end at once, and they are refused at every request and sign-in from then on. Their
roles are kept. Name the user by `--sub` (the IdP subject, as for the first owner), `--id` (Studio's
user id), or `--email` (refused when several users share the address). The last enabled owner of an
organisation cannot be disabled: make someone else owner first. `enable` with the same options lets
them back in; they sign in anew to get their roles back. Each change is recorded in the audit log of
every organisation the user belongs to.

**Roles from the IdP (optional, off by default).** Set both `OIDC_ROLE_CLAIM` (for example `groups`)
and `OIDC_ROLE_MAP`, a comma-separated list of `value=org-slug:role`:

```bash
OIDC_ROLE_CLAIM=groups
OIDC_ROLE_MAP=studio-admins=acme:admin,acme-billing=acme:billing
```

At every sign-in, each value the person carries grants its role in that organisation where they have
no role yet, and roles granted this way follow the claim: raised, lowered, or withdrawn when the
value is gone. The limits:

- `owner` can never be mapped; Studio refuses to start if the map names it.
- **A role assigned in Studio wins.** Any change in Studio (role change, removal, leaving, accepting
  an invitation) takes the membership out of the claim's hands for good.
- **A removal does not outlast the claim.** Someone removed in Studio who still carries the value
  gets the role back at their next sign-in. Take the value away at the IdP or remove the map entry.
- **Between sign-ins a granted role stands.** Taking a value away at the IdP withdraws the role at
  the next sign-in, not before. To cut access at once, disable the user (above).

### Central auth service (`AUTH_MODE=better-auth`, the default)

Studio can instead use a separate [Better Auth](https://better-auth.com) service with the JWT and
organization plugins, for example one shared by several products. Studio then stores no users: it
reads the service's session cookie (`better-auth.session_token`), exchanges it at
`{AUTH_ISSUER}/api/auth/token` for a short-lived JWT, and verifies that JWT against
`{AUTH_ISSUER}/.well-known/jwks.json`. The browser reaches the service through Studio's own
`/api/auth/*` proxy. Organisations, members and invitations live in the auth service; Studio mirrors
each organisation role into `org_member` for its access checks, writing through the service with
`ORG_WRITE_SERVICE_SECRET`.

Set `AUTH_ISSUER`, `AUTH_AUDIENCE`, `NUXT_PUBLIC_AUTH_URL` and `ORG_WRITE_SERVICE_SECRET` (and
`AUTH_INTERNAL_URL` when the issuer URL is not reachable from the container).
[`apps/studio/.env.example`](./apps/studio/.env.example) lists what the service must enable. No
reference auth service ships in this repository. Owners cannot be assigned inside Studio in this
mode.

## Permissions

Roles live in Studio's database and are assigned in Studio. With `AUTHORIZER=local` every decision
is read from them on each request, so a change applies to the next one.

**Organisation roles**, from lowest to highest:

| Role      | May                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `billing` | Manage billing. **No access to projects.**                                                                |
| `member`  | View every project in the organisation.                                                                   |
| `admin`   | Create projects, and view every project.                                                                  |
| `manager` | Manage members and invitations, create projects, and administer every project.                            |
| `owner`   | Everything, including changing other owners and handing ownership over. An organisation can have several. |

- You can assign or change only roles below your own. Only an owner can make or change an owner, and
  only in `oidc` mode.
- **Owner transfer** (`oidc` mode): an owner can make another member owner and step down in one
  action, from the member's page (`POST /api/orgs/:orgId/ownership-transfer`).
- **Last owner**: demoting, removing or leaving as the last owner is refused. A disabled owner does
  not count as an owner.
- **Isolation**: a role in one organisation never answers a question about another. To someone who
  is not a member, an organisation looks as if it does not exist.

**Project roles**: `viewer` < `editor` (edit tokens, publish, activate) < `admin` (API keys and
members). A person's role on a project is the highest of their direct project role and what their
organisation role gives: owner and manager give `admin`, admin and member give `viewer`, billing
gives nothing.

**Machine keys** (`sk_…`) belong to one project and are at most `editor`. They never hold an
organisation role and cannot raise their own rights.

Unknown role values grant nothing, and a database error is answered with 503, never with access.

## Error monitoring (Sentry, optional)

Studio can report errors and performance traces to [Sentry](https://sentry.io), using the
[`@sentry/nuxt`](https://docs.sentry.io/platforms/javascript/guides/nuxt/) SDK. It is **off by
default**: with no DSN configured the SDK is disabled on both the server and in the browser, and
nothing is sent anywhere.

It is configured **only through environment variables, at runtime**. You do not change code or
rebuild the image:

| Variable                         | When it is read                | Purpose                                                                                                                   |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_SENTRY_DSN`         | runtime (container start)      | Your project's DSN. Empty (the default) disables Sentry. Browsers receive it too, which is normal: a DSN is not a secret. |
| `NUXT_PUBLIC_SENTRY_ENVIRONMENT` | runtime (container start)      | The `environment` tag on events, for example `production` or `staging`.                                                   |
| `SENTRY_AUTH_TOKEN`              | build time only, never runtime | Uploads source maps while building the image. Optional, and usually not needed; see below.                                |

Enable it by adding the two runtime variables to the environment you already use:

```bash
# .env.production (read by docker-compose.production.yml)
NUXT_PUBLIC_SENTRY_DSN=https://<public-key>@<your-sentry-host>/<project-id>
NUXT_PUBLIC_SENTRY_ENVIRONMENT=production
```

```yaml
# or directly under the app service in a compose file
services:
  app:
    environment:
      NUXT_PUBLIC_SENTRY_DSN: https://<public-key>@<your-sentry-host>/<project-id>
      NUXT_PUBLIC_SENTRY_ENVIRONMENT: production
```

```bash
# or with plain docker
docker run -e NUXT_PUBLIC_SENTRY_DSN=... -e NUXT_PUBLIC_SENTRY_ENVIRONMENT=production ... <image>
```

Restart the container after changing them. For local development, put the same two lines in
`apps/studio/.env`.

### Use your own Sentry

Events go only to the DSN you configure. Nothing is sent to the maintainers of this project.

1. Use [sentry.io](https://sentry.io) or your own
   [self-hosted Sentry](https://develop.sentry.dev/self-hosted/).
2. Create a project with the platform **Nuxt** (JavaScript).
3. Copy the DSN from **Project Settings → Client Keys (DSN)**.
4. Set `NUXT_PUBLIC_SENTRY_DSN` as above and restart.
5. Check that it works: load Studio in a browser and look in the Network tab for requests to your
   Sentry host, then look for the first events in your project. Sentry's own project setup page also
   waits for a first event.

### What is captured

- **Errors**, from the browser and from the server (Nitro).
- **Performance tracing**, sampled at 100% outside production and **10% in production** (`NODE_ENV`
  of the official image).
- **Session Replay and profiling are not enabled.**

Events include what the SDK normally records, such as stack traces, the request URL and browser
information. Studio's CDN URLs contain the project key (`/k/<key>/...`), so if that matters to you,
use Sentry's data-scrubbing rules for your project.

### Source maps (build time, optional)

The image is built without source-map upload by default, and source maps are never shipped in the
image: they are deleted from the build output. If you build your own image and want readable stack
traces, you can pass an auth token as a BuildKit **secret**, not as a build argument, so it never
lands in an image layer:

```bash
docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN -t grundtone-studio:local .
```

The upload target (`org` and `project`) is set in the `sentry` block of
[`apps/studio/nuxt.config.ts`](./apps/studio/nuxt.config.ts). Change it to your own organisation and
project before using a token, or leave `SENTRY_AUTH_TOKEN` unset.

## Development

```bash
pnpm install --frozen-lockfile   # also installs the husky git hooks
pnpm dev                          # turbo run dev
pnpm lint                         # eslint + stylelint
pnpm typecheck
pnpm test                         # vitest across the workspace
pnpm build
pnpm check                        # lint, typecheck, test and format check together
pnpm db:generate                  # create a Drizzle migration after a schema change
pnpm db:migrate:local             # apply migrations using apps/studio/.env
pnpm db:seed                      # seed demo data (needs NODE_ENV=development for the bypass)
pnpm i18n:check                   # English/Danish key parity
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org) and are checked by
commitlint. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow. CI runs on GitHub
Actions (see [`.github/workflows`](./.github/workflows)).

## Repository layout

| Path                                             | What it is                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| [`apps/studio`](./apps/studio)                   | The Nuxt 3 application (UI, API, database schema and migrations). |
| [`packages/saas-client`](./packages/saas-client) | Runtime SDK served to consuming apps.                             |
| [`packages/dtcg`](./packages/dtcg)               | Token conversion to and from the DTCG format.                     |
| [`packages/tokens-cli`](./packages/tokens-cli)   | Headless token-management CLI.                                    |
| `docker/`, `Dockerfile`, `Caddyfile`             | Container image, entrypoint and reverse-proxy configuration.      |

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md) first.

## Security

Please report vulnerabilities privately; see [SECURITY.md](./SECURITY.md). Do not open a public
issue for a security problem.

## License

Grundtone Studio is licensed under the [GNU Affero General Public License v3.0](./LICENSE)
(`AGPL-3.0-only`). If you run a modified version as a network service, the AGPL requires you to
offer its source code to the users of that service.

## Related repositories

- [Grundtone](https://github.com/30Blackbirds/grundtone): the open-source design system and tokens
  that Studio configures.
- [Resotone](https://github.com/30Blackbirds/resotone): a self-hosted headless CMS.
