CREATE TABLE "billing_checkout_throttle" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "billing_checkout_throttle_window_idx" ON "billing_checkout_throttle" USING btree ("window_started_at");