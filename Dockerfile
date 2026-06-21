FROM node:24-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
# Workspace manifests first for cache-friendly install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/studio/package.json ./apps/studio/
COPY packages/saas-client/package.json ./packages/saas-client/
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/studio/node_modules ./apps/studio/node_modules
COPY --from=deps /app/packages/saas-client/node_modules ./packages/saas-client/node_modules
COPY . .
# Build saas-client first (workspace dep), then the Nuxt app
RUN pnpm --filter @grundtone/saas-client build && \
    pnpm --filter @grundtone-studio/studio build

# pnpm deploy bygger en self-contained bundle for studio-workspace.
# OBS: vi inkluderer dev-deps fordi Nitro's .output bundle'r packages
# (unhead, vue, vue-router, hookable, ...) der opfattes som dev men er
# nødvendige runtime. --prod-flag fjerner dem og giver ERR_MODULE_NOT_FOUND
# på første request. Bundle-bloat ~50 MB accepteret indtil Nuxt nitro
# konfigureres til fully-inline output (nitro.rollupConfig.external = []).
RUN pnpm --filter @grundtone-studio/studio deploy --legacy /deploy

FROM node:24-alpine AS runner
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
