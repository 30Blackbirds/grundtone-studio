# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
# Workspace manifests first for cache-friendly install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/studio/package.json ./apps/studio/
COPY packages/saas-client/package.json ./packages/saas-client/
# .npmrc auth'er @klanghaus-scope (privat GitHub Packages: auth-jwt + permissions-client)
# — token som BuildKit-secret (samme mønster som auth-repoet).
RUN --mount=type=secret,id=node_auth_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" pnpm install --frozen-lockfile --prod=false

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
# deploy re-resolver workspace-deps inkl. private @klanghaus-pakker → samme
# build-secret som deps-stagen (ellers falder den tilbage til npmjs.org → 404).
RUN --mount=type=secret,id=node_auth_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" \
    pnpm --filter @grundtone-studio/studio deploy --legacy /deploy

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

FROM node:26-alpine AS runner
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
COPY --chown=app:app docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x /app/entrypoint.sh

USER app
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
