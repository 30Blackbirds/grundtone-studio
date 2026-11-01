# syntax=docker/dockerfile:1.7
#
# ⚠️ The Node version here MUST match .nvmrc (24.21.0) and engines.node
# (>=24.18.1), otherwise CI tests one runtime and production runs another.
# Both FROM lines pin the multi-arch index digest (linux/amd64 + linux/arm64),
# measured with `docker buildx imagetools inspect node:24.21.0-alpine`, so a
# re-pushed tag cannot change the runtime under the same version. Bump the
# version and the digest together.
# The tag is pinned to the full version for that reason: on 2026-09-15 the
# floating node:24-alpine gave v24.18.1 from a local cache and v24.21.0 after a
# pull, so the image's Node depended on when it was built.
#
# Dependabot bumpede denne til 26-alpine alene (#161) og brækkede builden:
# **Node 26 har FJERNET corepack fra de officielle images** (deprecated i 25),
# så `corepack enable pnpm` fejler med exit 127. Verificeret direkte:
# node:24-alpine har corepack, node:26-alpine har ikke.
#
# Skal vi til Node 26, er det en koordineret ændring: bump .nvmrc + engines
# SAMTIDIG, og erstat corepack med en eksplicit pnpm-installation
# (`RUN npm i -g pnpm@<version>` eller pnpm/action-setup-ækvivalent).
# Et ensidigt Dockerfile-bump er ikke nok.
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
# Workspace manifests first for cache-friendly install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/studio/package.json ./apps/studio/
COPY packages/saas-client/package.json ./packages/saas-client/
# No registry token: @klanghaus/auth-jwt and permissions-client are vendored in
# apps/studio/server/vendor/ (KH-944, 2026-10-24), so every dependency is public.
#
# --ignore-scripts, as in account and auth: no package's install-time code runs
# in the build. Measured 2026-10-25, it skips exactly two lifecycle scripts and
# neither is needed here: the root `prepare` (husky, git hooks) and studio's
# `postinstall` (`nuxt prepare`, which `nuxt build` below does itself).
# Dependency build scripts were already off: pnpm 10 runs none without an
# `onlyBuiltDependencies` list, and this repo has none.
RUN pnpm install --frozen-lockfile --prod=false --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/studio/node_modules ./apps/studio/node_modules
COPY --from=deps /app/packages/saas-client/node_modules ./packages/saas-client/node_modules
COPY . .
# Build saas-client first (workspace dep), then the Nuxt app.
# sentry_auth_token: @sentry/nuxt uploader sourcemaps under builden når
# SENTRY_AUTH_TOKEN er sat; secret-mount (ikke ARG) så tokenet aldrig lander
# i et image-layer. Uden secret (lokale builds) skipper upload stille.
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    pnpm --filter @grundtone/saas-client build && \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    pnpm --filter @grundtone-studio/studio build && \
    find apps/studio/.output -name '*.map' -delete && \
    cp -RL apps/studio/.output /tmp/output-real && \
    rm -rf apps/studio/.output && \
    mv /tmp/output-real apps/studio/.output
    # map-delete: belt-and-braces — Sentry sletter maps efter upload, men bygges
    # imaget UDEN token (upload skippet) må maps stadig aldrig shippe offentligt.
    #
    # cp -RL/mv (v0.2.11-incident, runde 5): Nitro skriver multi-versions-pakker
    # (fx @opentelemetry/core@2.8+2.10) som SYMLINKS ind i .output/server/
    # node_modules/.nitro-storen. Dereferencéres de i et SENERE lag (runde 2-
    # fixet), type-skifter pathen symlink→dir på tværs af layers — og CI's
    # buildx-export (amd64-runner + registry-push) TABTE netop de paths i det
    # endelige image, selv om builder-assertionen bestod. Lokal docker-driver
    # rammes ikke — kun det pushede image fejlede. Deref IN-PLACE i SAMME RUN
    # som skaber .output betyder at intet lag nogensinde indeholder symlinks
    # der senere skal erstattes: klassen kan ikke opstå.

# pnpm deploy bygger en self-contained bundle for studio-workspace.
# OBS: vi inkluderer dev-deps fordi Nitro's .output bundle'r packages
# (unhead, vue, vue-router, hookable, ...) der opfattes som dev men er
# nødvendige runtime. --prod-flag fjerner dem og giver ERR_MODULE_NOT_FOUND
# på første request. Bundle-bloat ~50 MB accepteret indtil Nuxt nitro
# konfigureres til fully-inline output (nitro.rollupConfig.external = []).
# deploy re-resolves workspace deps; all of them are public since the vendoring.
# --ignore-scripts for the same reason as the install above.
RUN pnpm --filter @grundtone-studio/studio deploy --legacy --ignore-scripts /deploy

# Assertion-only (deref sker nu in-place i build-RUN'et ovenfor, så pnpm
# deploy kopierer rigtige filer fra fødslen): de tre multi-versions-pakker
# der blev tabt i runde 4 SKAL findes, og .output må være 100% symlink-frit.
# Boot-smoken i build.yml er den endelige gate på det EKSPORTEREDE image.
RUN test -f /deploy/.output/server/node_modules/@opentelemetry/core/package.json \
 && test -f /deploy/.output/server/node_modules/@opentelemetry/resources/package.json \
 && test -f /deploy/.output/server/node_modules/@opentelemetry/api-logs/package.json \
 && [ -z "$(find /deploy/.output -type l | head -1)" ]

# Nitro beholder `unhead` som external men dens trace misser den transitive
# `hookable`-dep (under pnpm er den ikke top-level-hoisted), så runtime kaster
# ERR_MODULE_NOT_FOUND. Kopiér hookable ind dér hvor unhead resolver den.
RUN HOOKABLE_SRC="$(find /deploy/node_modules/.pnpm -maxdepth 3 -type d -path '*hookable@6*/node_modules/hookable' | head -1)" \
 && echo "hookable kilde: $HOOKABLE_SRC" \
 && cp -r "$HOOKABLE_SRC" /deploy/.output/server/node_modules/hookable \
 && test -f /deploy/.output/server/node_modules/hookable/package.json

FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS runner

# 🔴 Revision ind i IMAGET, ikke kun i workflowet. /api/healthz laeste allerede
# NUXT_PUBLIC_APP_VERSION men ingen satte den — prod svarede "dev", og den
# eneste maade at bekraefte et deploy var at sideindholdet tilfaeldigvis
# afsloerede versionen (maalt 2026-08-14, beslutning AJ). ENV frem for kun
# ARG: Nitro laeser process.env ved REQUEST-tid i det prunede image, saa
# vaerdien skal overleve som containermiljoe. Verificeres af boot-smoke,
# ikke antaget (v0.2.11-laeren: kun det prunede image taeller).
ARG APP_VERSION=dev
ARG REVISION=unknown
ENV NUXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NUXT_PUBLIC_APP_REVISION=$REVISION
WORKDIR /app
ENV NODE_ENV=production
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

# pnpm-deploy-bundle: self-contained med Nitro-.output + node_modules
# (resolved symlinks, prod-only). Kopierer hele /deploy som indeholder
# .output, server/db, package.json, node_modules — alt klar til runtime.
COPY --from=builder --chown=app:app /deploy ./
# Changelog files read by /api/changelog/[source] at runtime
COPY --from=builder --chown=app:app /app/CHANGELOG.md ./CHANGELOG.md
COPY --from=builder --chown=app:app /app/packages/saas-client/CHANGELOG.md ./packages/saas-client/CHANGELOG.md
# SDK bundles served by /client/[file] — the CDN pull zone uses studio as its
# origin, so this copy is what cdn.grundtone.com serves (KH-988)
COPY --from=builder --chown=app:app /app/packages/saas-client/dist ./packages/saas-client/dist
# Every PUBLISHED SDK contract version, served byte-for-byte at /client/v<x.y.z>.*
# (KH-991). The dist above is only ever the LATEST build; without this copy a
# contract bump would turn every older versioned URL into a 404 and break the
# SRI pins on it. /app is the runtime cwd, so the route finds this at
# ./sdk-contract.
COPY --from=builder --chown=app:app /app/apps/studio/sdk-contract ./sdk-contract
COPY --chown=app:app docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x /app/entrypoint.sh

USER app
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
