DROP TABLE IF EXISTS "account" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "invitation" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "member" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "organization" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "session" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "user" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "verification" CASCADE;--> statement-breakpoint
ALTER TABLE "active_version" ADD COLUMN "activated_by_email" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "created_by_email" text;--> statement-breakpoint
ALTER TABLE "config_version" ADD COLUMN "published_by_email" text;--> statement-breakpoint
ALTER TABLE "project_invitation" ADD COLUMN "invited_by_email" text;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "member_email" text;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "member_name" text;