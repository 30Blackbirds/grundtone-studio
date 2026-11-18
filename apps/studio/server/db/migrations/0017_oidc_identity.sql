CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oidc_login" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"next" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identity" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_identity" ADD CONSTRAINT "user_identity_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oidc_login_expires_idx" ON "oidc_login" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identity_unique_idx" ON "user_identity" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "user_identity_user_idx" ON "user_identity" USING btree ("user_id");