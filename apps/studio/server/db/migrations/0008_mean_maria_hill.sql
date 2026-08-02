CREATE TABLE "org_suspension" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"suspended_at" timestamp with time zone NOT NULL,
	"cdn_grace_until" timestamp with time zone NOT NULL
);
