CREATE TABLE "auth_data_export_request" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"token_digest" text,
	"archive" jsonb,
	"failed_module_id" text
);
--> statement-breakpoint
ALTER TABLE "auth_data_export_request" ADD CONSTRAINT "auth_data_export_request_requested_by_auth_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_data_export_request_scope_idx" ON "auth_data_export_request" USING btree ("scope_kind","scope_id","status");