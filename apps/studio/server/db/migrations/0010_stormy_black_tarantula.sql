CREATE TABLE "font_licence_attestation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"slot" text NOT NULL,
	"file" text NOT NULL,
	"weight" integer NOT NULL,
	"family" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "font_licence_attestation_project_idx" ON "font_licence_attestation" USING btree ("project_id","created_at");