CREATE TABLE "org_member" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_member_role_known" CHECK ("org_member"."role" IN ('owner', 'manager', 'admin', 'member', 'billing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_member_unique_idx" ON "org_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_member_user_idx" ON "org_member" USING btree ("user_id");