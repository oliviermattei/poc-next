CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"organization_id" text,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"origin_path" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_category_idx" ON "feedback" USING btree ("category");--> statement-breakpoint
CREATE INDEX "feedback_author_idx" ON "feedback" USING btree ("author_id");