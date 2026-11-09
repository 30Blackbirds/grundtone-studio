CREATE TABLE "org_member" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_member_role_known" CHECK ("org_member"."role" IN ('owner', 'manager', 'admin', 'member', 'billing'))
);
--> statement-breakpoint
CREATE TABLE "project_machine_grant" (
	"project_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_machine_grant_editor_only" CHECK ("project_machine_grant"."role" = 'editor')
);
--> statement-breakpoint
ALTER TABLE "project_machine_grant" ADD CONSTRAINT "project_machine_grant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_machine_grant" ADD CONSTRAINT "project_machine_grant_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_member_unique_idx" ON "org_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_member_user_idx" ON "org_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_machine_grant_unique_idx" ON "project_machine_grant" USING btree ("project_id","api_key_id");