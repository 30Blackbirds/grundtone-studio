CREATE TABLE "tenant_event_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"organization_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"parked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_event_outbox_provisioned_once_idx" ON "tenant_event_outbox" USING btree ("organization_id") WHERE "tenant_event_outbox"."event_type" = 'tenantProvisioned';--> statement-breakpoint
CREATE INDEX "tenant_event_outbox_due_idx" ON "tenant_event_outbox" USING btree ("next_attempt_at") WHERE "tenant_event_outbox"."delivered_at" IS NULL AND "tenant_event_outbox"."parked_at" IS NULL;