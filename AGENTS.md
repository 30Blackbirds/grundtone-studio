# AGENTS.md

Repo-wide conventions live in [`CLAUDE.md`](./CLAUDE.md); workflow lives in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). This file adds environment/operational notes for agents.

## Cursor Cloud specific instructions

Grundtone Studio is a pnpm + turbo monorepo with two products:

- `apps/studio` — the Nuxt 3 SaaS app (web UI + Nitro API), dev server on **:3000**.
- `packages/saas-client` — the runtime SDK (`@grundtone/saas-client`), a build-only Vite library.

Standard commands are already documented — see root `package.json` scripts, the `Makefile`
(`make dev` does the full local bring-up), and the "Local mirror of CI" section in
`CONTRIBUTING.md`. Notes below are only the non-obvious gotchas.

### Node / pnpm

- Node **24** is required (`.nvmrc` → `24.21.0`, `engine-strict=true`). The image's default
  `/exec-daemon/node` is **v22** and wins in non-interactive shells, which makes `pnpm install` fail
  the engine check. Activate nvm first: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use`
  (the update script already does this; interactive login shells get Node 24 automatically because
  the nvm `default` alias is pinned to `24.21.0`).
- pnpm `10.14.0` is provided via corepack.
- `engines.node` is `>=24.18.1` (the Node 24 security release) and `engine-strict=true`, so
  `pnpm install` fails with `ERR_PNPM_UNSUPPORTED_ENGINE` on any older Node. That includes the Node
  **pnpm itself runs on**, which can differ from `node -v`: a volta or corepack pnpm shim pinned to
  an older runtime fails even when `node -v` prints 24.21.0 (measured 2026-09-17: volta's pnpm ran
  on 24.16.0). Check with `pnpm exec node -v`.

### Vendored `@klanghaus/*` packages — no registry token

`apps/studio` used to install `@klanghaus/auth-jwt` and `@klanghaus/permissions-client` from GitHub
Packages, which needed a `read:packages` token everywhere (`NODE_AUTH_TOKEN`). Since 2026-10-24
(KH-944) both are **vendored** in `apps/studio/server/vendor/`, so every dependency is public and
`pnpm install` needs no token.

- Each package keeps a `manifest.json` (source repo, tag, commit, sha256 per file). The copies are
  byte-identical to their tags: do NOT edit or reformat them (prettier and eslint ignore the folder;
  `tests/vendored-packages.test.ts` turns red on a changed, extra or missing file).
- To take an upstream change: copy the files from the new tag, rewrite the manifest, and run
  `node apps/studio/scripts/vendor-drift.mjs --upstream <ref>` (needs `gh` access to the source
  repos).

### Backing services (Postgres + MinIO)

`apps/studio/docker-compose.yml` provides Postgres (host **54320**) and MinIO (**9000**/**9001**,
bucket `grundtone-studio` auto-created). Docker is installed in the snapshot but the daemon is not
started automatically — start it once per boot with `sudo dockerd &` (configured for the
`fuse-overlayfs` storage driver with the containerd-snapshotter disabled, and legacy iptables; these
are required in this VM). Then `cd apps/studio && docker compose up -d`. `make dev` orchestrates
containers → migrate → seed → dev server.

`apps/studio/.env` is created from `.env.example`; its dev defaults already point at these services.

### Full authenticated E2E needs two external services

Studio delegates auth + authz to two services that are **not in this repo**: a central Auth service
(`AUTH_ISSUER`, dev default `http://localhost:3001`) and a Permissions PDP (`PERMISSIONS_URL`, dev
default `http://localhost:8080`), from sibling repos `KlangHaus/auth` and `KlangHaus/permissions`
(wired together via `docker-compose.tilt.yml` + the `KlangHaus/infra` Tiltfile). Without them, only
public pages (`/login`), `/api/healthz`, and the CDN routes (`/k/<key>/<file>`) work; any
authenticated route fails on the first request.

### Hooks

`.husky` runs lint-staged + `turbo run typecheck` on pre-commit, commitlint on commit-msg, and
`turbo run test` on pre-push. Fix failures rather than bypassing with `--no-verify`.
