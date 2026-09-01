CREATE TABLE "auth_passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_passkey" ADD CONSTRAINT "auth_passkey_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_passkey_user_id_idx" ON "auth_passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_passkey_credential_id_key" ON "auth_passkey" USING btree ("credential_id");