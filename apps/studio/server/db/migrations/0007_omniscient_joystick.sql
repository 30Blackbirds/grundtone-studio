DROP TABLE "account" CASCADE;--> statement-breakpoint
DROP TABLE "invitation" CASCADE;--> statement-breakpoint
DROP TABLE "member" CASCADE;--> statement-breakpoint
DROP TABLE "organization" CASCADE;--> statement-breakpoint
DROP TABLE "session" CASCADE;--> statement-breakpoint
DROP TABLE "user" CASCADE;--> statement-breakpoint
DROP TABLE "verification" CASCADE;--> statement-breakpoint
ALTER TABLE "active_version" ADD COLUMN "activated_by_email" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "created_by_email" text;--> statement-breakpoint
ALTER TABLE "config_version" ADD COLUMN "published_by_email" text;--> statement-breakpoint
ALTER TABLE "project_invitation" ADD COLUMN "invited_by_email" text;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "member_email" text;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "member_name" text;