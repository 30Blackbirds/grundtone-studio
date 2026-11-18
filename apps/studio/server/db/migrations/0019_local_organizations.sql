CREATE TABLE "org_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "org_invitation_role_known" CHECK ("org_invitation"."role" IN ('owner', 'manager', 'admin', 'member', 'billing'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_invitation" ADD CONSTRAINT "org_invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitation_token_idx" ON "org_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "org_invitation_org_idx" ON "org_invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_unique_idx" ON "organization" USING btree ("slug");