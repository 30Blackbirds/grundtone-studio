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

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

# Nitro produces a self-contained .output bundle — no extra node_modules needed for serving
COPY --from=builder --chown=app:app /app/apps/studio/.output ./.output
# Drizzle migrations + entrypoint for runtime db:migrate
COPY --from=builder --chown=app:app /app/apps/studio/server/db ./server/db
COPY --from=builder --chown=app:app /app/apps/studio/package.json ./package.json
# Runtime needs tsx + drizzle-orm/kit + pg-driver for entrypoint.sh's migrate step.
# Studio-workspace's node_modules has alle bin-scripts (tsx) + lokale deps.
# Mountes som /app/node_modules så entrypoint.sh's cwd-relative path virker.
COPY --from=builder --chown=app:app /app/apps/studio/node_modules ./node_modules
# Changelog files read by /api/changelog/[source] at runtime
COPY --from=builder --chown=app:app /app/CHANGELOG.md ./CHANGELOG.md
COPY --from=builder --chown=app:app /app/packages/saas-client/CHANGELOG.md ./packages/saas-client/CHANGELOG.md
COPY --chown=app:app docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x /app/entrypoint.sh

USER app
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
