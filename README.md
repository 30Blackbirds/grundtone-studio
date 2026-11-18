<div align="center">

# Grundtone Studio

**Configure your Grundtone design system in a web UI, and ship the result to every app that uses
it.**\
Multi-tenant, self-hostable, open source.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

[Grundtone design system](https://github.com/30Blackbirds/grundtone) ·
[Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

</div>

---

Grundtone Studio is the management layer for [Grundtone](https://github.com/30Blackbirds/grundtone)
design systems. Organisations create projects (design-system instances), edit design tokens,
colours, fonts and logos in a web UI, publish a version, and every consuming app picks it up through
a small runtime SDK and an API key.

## Features

- **Projects per organisation**, with roles (viewer, editor, admin) and invitations.
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
- [Development](#development)
- [Repository layout](#repository-layout)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Related repositories](#related-repositories)

## Prerequisites

| Tool                | Version                                                               |
| ------------------- | --------------------------------------------------------------------- |
| Node.js             | `24.21.0` (see [`.nvmrc`](./.nvmrc)); `engines` requires >=24.18.1    |
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
FEATURE_BILLING=off
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

| Concern            | How Studio does it                                                                                                                                                                                                                                                                                                                             | Self-hoster's choice                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication** | Studio does not store users or passwords. It reads the auth service's session cookie (`better-auth.session_token`), exchanges it at `{AUTH_ISSUER}/api/auth/token` for a short-lived JWT, and verifies that JWT against `{AUTH_ISSUER}/.well-known/jwks.json`. The browser talks to the auth service through Studio's own `/api/auth/*` proxy. | You need a separate auth service with that contract (a [Better Auth](https://better-auth.com) server with the JWT plugin). **No reference implementation is bundled in this repository yet.** |
| **Permissions**    | Every access decision goes through one interface (`server/lib/authorizer.ts`). `AUTHORIZER=local` decides from Studio's own database (`org_member`, `project_member`, `project_machine_grant`). `AUTHORIZER=pdp` asks an external permissions service over Connect-RPC (`PERMISSIONS_URL`, `PDP_S2S_TOKEN`).                                   | Use `AUTHORIZER=local`. It needs nothing beyond PostgreSQL.                                                                                                                                   |
| **Notifications**  | Transactional e-mail (invitations, password reset, account deletion) is sent over SMTP with nodemailer. With `SMTP_HOST` empty, e-mails are printed to the server log instead of sent.                                                                                                                                                         | Point `SMTP_*` at any SMTP relay.                                                                                                                                                             |
| **Billing**        | `FEATURE_BILLING=on` enables checkout, the billing page and brand-count reporting to an external account service (`ACCOUNT_URL`). `off` answers 404 and sends nothing.                                                                                                                                                                         | Use `FEATURE_BILLING=off`.                                                                                                                                                                    |
| **CDN**            | Studio serves published tokens itself under `/k/...` and `/client/...`. If `BUNNY_PURGE_API_KEY` is set it purges a Bunny.net CDN on publish; empty disables this.                                                                                                                                                                             | Leave `BUNNY_PURGE_API_KEY` empty, or put your own CDN in front and set `NUXT_PUBLIC_CDN_BASE` to it.                                                                                         |

> **Status.** `AUTHORIZER=local`, `FEATURE_BILLING=off` and SMTP make permissions, billing and
> e-mail fully self-contained. **Sign-in is the open gap:** until an open-source auth service that
> speaks the contract above ships alongside Studio, a production self-host has to run a compatible
> Better Auth service itself. See [`apps/studio/.env.example`](./apps/studio/.env.example) for the
> settings that service must enable.

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

| Variable                                   | Required              | Purpose                                                                                               |
| ------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `IMAGE_TAG`, `DOMAIN`                      | yes                   | Read by Compose: the image tag to run and the public hostname Caddy serves.                           |
| `DATABASE_URL`                             | yes                   | PostgreSQL connection string. Use `?sslmode=require` for managed databases.                           |
| `AUTHORIZER`                               | yes                   | `local` or `pdp`. No default; Studio refuses to start without it.                                     |
| `FEATURE_BILLING`                          | yes                   | `on` or `off`. No default; Studio refuses to start without it.                                        |
| `AUTH_ISSUER`                              | yes                   | Base URL of the auth service. Also the JWT issuer and JWKS source.                                    |
| `AUTH_AUDIENCE`                            | yes                   | JWT audience Studio accepts. By convention equal to `AUTH_ISSUER`.                                    |
| `AUTH_INTERNAL_URL`                        | no                    | Server-side address of the auth service when `AUTH_ISSUER` is not reachable from the container.       |
| `NUXT_PUBLIC_AUTH_URL`                     | yes                   | Browser-facing base URL for auth requests (typically Studio's own origin).                            |
| `ORG_WRITE_SERVICE_SECRET`                 | yes                   | Shared secret (at least 32 bytes) for organisation-membership writes; same value on the auth service. |
| `NUXT_PUBLIC_APP_URL`                      | yes                   | Studio's public URL, used in invitation links.                                                        |
| `NUXT_PUBLIC_CDN_BASE`                     | yes (prod)            | Base URL the install snippets point at. The app refuses to start in production without it.            |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | yes                   | S3-compatible storage for logos, fonts and published tokens.                                          |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes                   | Credentials for that bucket.                                                                          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`    | no                    | Outgoing e-mail. Empty `SMTP_HOST` logs e-mails instead of sending them.                              |
| `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | no                    | SMTP credentials and the sender address.                                                              |
| `PERMISSIONS_URL`, `PDP_S2S_TOKEN`         | with `AUTHORIZER=pdp` | External permissions service and its service token.                                                   |
| `ACCOUNT_DELETED_WEBHOOK_SECRET`           | no                    | Secret for the account-deletion webhook the auth service calls (`POST /api/account/deleted`).         |
| `IDENTITY_EXPORT_SERVICE_SECRET`           | no                    | Secret for the GDPR data-export call to the auth service.                                             |
| `BUNNY_PURGE_API_KEY`                      | no                    | Bunny.net CDN purge on publish. Leave empty if you do not use Bunny.                                  |
| `NUXT_PUBLIC_SENTRY_DSN`                   | no                    | Sentry error reporting. Empty disables it.                                                            |

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
