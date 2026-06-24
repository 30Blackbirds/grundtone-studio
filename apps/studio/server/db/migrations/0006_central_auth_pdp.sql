-- Phase 2: studio consumes the CENTRAL auth service + permissions PDP.
--
-- Two changes in this migration:
--   1. Denormalize actor identity onto studio-owned tables (nullable email/name
--      columns) so member / key / version / invitation views render without a
--      cross-service join back to the central auth DB.
--   2. Drop the embedded Better Auth identity tables — user / session / account
--      / verification / organization / member / invitation now live exclusively
--      in the central auth service's database. Studio references org id (text,
--      = JWT org/tenant) and user id (text, = JWT sub) by value only.
--
-- The studio tables that referenced these by *value* (project.organization_id,
-- project_member.user_id, audit_log.actor_user_id, etc.) had no FK to them, so
-- the drops are safe. CASCADE clears the internal FKs between the auth tables.
--
-- NB for [infra]: drizzle-kit-generated meta snapshot (0006) must be produced by
-- running `pnpm --filter @grundtone-studio/studio db:generate` so the snapshot
-- matches schema.ts. This hand-written SQL is the intended diff; regenerate to
-- get the canonical meta/0006_snapshot.json + journal entry if they drift.

-- ── 1. Denormalized identity columns ────────────────────────────────────────
ALTER TABLE "api_key" ADD COLUMN "created_by_email" text;--> statement-breakpoint
ALTER TABLE "config_version" ADD COLUMN "published_by_email" text;--> statement-breakpoint
ALTER TABLE "active_version" ADD COLUMN "activated_by_email" text;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "member_email" text;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "member_name" text;--> statement-breakpoint
ALTER TABLE "project_invitation" ADD COLUMN "invited_by_email" text;--> statement-breakpoint

-- ── 2. Drop embedded auth tables (now in the central auth service) ───────────
DROP TABLE IF EXISTS "invitation" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "member" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "session" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "account" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "verification" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "organization" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "user" CASCADE;
