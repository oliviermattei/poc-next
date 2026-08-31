CREATE TABLE "contact_message" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "contact_message_email_idx" ON "contact_message" USING btree ("email");--> statement-breakpoint
CREATE INDEX "public_form_throttle_window_idx" ON "public_form_throttle" USING btree ("window_started_at");