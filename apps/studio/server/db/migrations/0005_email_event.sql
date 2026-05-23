CREATE TABLE "email_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text,
	"recipient" text NOT NULL,
	"event_type" text NOT NULL,
	"bounce_type" text,
	"description" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_event_recipient_idx" ON "email_event" USING btree ("recipient");
--> statement-breakpoint
CREATE INDEX "email_event_message_idx" ON "email_event" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "email_event_received_idx" ON "email_event" USING btree ("received_at");
