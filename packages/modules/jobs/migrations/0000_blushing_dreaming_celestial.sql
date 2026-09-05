CREATE TABLE "job_run" (
	"run" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_run_job_idx" ON "job_run" USING btree ("job");--> statement-breakpoint
CREATE INDEX "job_run_claimed_idx" ON "job_run" USING btree ("claimed_at");