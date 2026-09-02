CREATE TABLE "storage_file" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_file_owner_purpose_key" ON "storage_file" USING btree ("owner_kind","owner_id","purpose");--> statement-breakpoint
CREATE INDEX "storage_file_owner_idx" ON "storage_file" USING btree ("owner_kind","owner_id");