CREATE TABLE "rate_limit_window" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_window_expires_idx" ON "rate_limit_window" USING btree ("expires_at");