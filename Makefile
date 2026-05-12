# Grundtone Studio — local dev shortcuts.
#
# `make` (or `make help`) shows what's available. Most days you only need
# `make dev` — it brings up Postgres + MinIO, applies migrations, seeds the
# test fixtures, and starts the Nuxt dev server in one go.

.DEFAULT_GOAL := help
.PHONY: help dev stop reset db migrate seed test lint typecheck build install logs clean

STUDIO_DIR := apps/studio
PG_CONTAINER := grundtone-studio-postgres-1

# ─── Public targets ────────────────────────────────────────────────────────

help: ## Show this help
	@echo "Grundtone Studio — make targets"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

dev: install up migrate seed ## Start everything (containers, migrate, seed, dev server)
	@echo "→ Starting Nuxt dev server on :3000"
	pnpm --filter @grundtone-studio/studio dev

stop: ## Stop Postgres + MinIO containers
	cd $(STUDIO_DIR) && docker compose stop

reset: ## Nuke containers + volumes and restart fresh
	cd $(STUDIO_DIR) && docker compose down -v
	$(MAKE) dev

db: up migrate seed ## Bring DB up + migrate + seed (no dev server)

migrate: ## Apply pending Drizzle migrations
	pnpm db:migrate:local

seed: ## Seed dev user + org + project (idempotent)
	pnpm db:seed

test: ## Run the workspace test suite
	pnpm test

lint: ## Run lint + stylelint + format check
	pnpm format:check
	pnpm lint
	pnpm stylelint

typecheck: ## Run the full workspace typecheck
	pnpm typecheck

build: ## Production build of saas-client + studio
	pnpm build

install: ## Install workspace dependencies (cached, fast no-op if up to date)
	@pnpm install --frozen-lockfile --silent

logs: ## Tail Postgres logs (Ctrl-C to exit)
	cd $(STUDIO_DIR) && docker compose logs -f postgres

clean: ## Stop containers, drop volumes, clear caches
	cd $(STUDIO_DIR) && docker compose down -v
	rm -rf $(STUDIO_DIR)/.nuxt $(STUDIO_DIR)/.output $(STUDIO_DIR)/.nitro
	find . -name 'node_modules/.vite' -prune -exec rm -rf {} + 2>/dev/null || true
	@echo "✓ caches cleared"

# ─── Internal targets ──────────────────────────────────────────────────────

up: ## Ensure Postgres + MinIO are running (internal)
	@if [ -z "$$(docker ps -q -f name=$(PG_CONTAINER))" ]; then \
		echo "→ Starting docker containers"; \
		cd $(STUDIO_DIR) && docker compose up -d; \
		echo "→ Waiting for Postgres to be healthy"; \
		until docker exec $(PG_CONTAINER) pg_isready -U grundtone >/dev/null 2>&1; do \
			sleep 1; \
		done; \
	else \
		echo "✓ Containers already running"; \
	fi
