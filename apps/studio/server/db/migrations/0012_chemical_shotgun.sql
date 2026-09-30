ALTER TABLE "api_key" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_scope_exclusive" CHECK (("api_key"."project_id" IS NOT NULL AND "api_key"."organization_id" IS NULL)
          OR ("api_key"."project_id" IS NULL AND "api_key"."organization_id" IS NOT NULL));