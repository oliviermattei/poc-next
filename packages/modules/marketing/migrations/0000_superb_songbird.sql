CREATE TABLE "public_form_throttle" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"source" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_subscription_source_email_key" ON "public_subscription" USING btree ("source","email");--> statement-breakpoint
CREATE INDEX "public_subscription_source_idx" ON "public_subscription" USING btree ("source");