CREATE TABLE "billing_purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_customer_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"price_id" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"provider_payment_id" text,
	"status" text NOT NULL,
	"amount" integer,
	"currency" text,
	"purchased_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_purchase" ADD CONSTRAINT "billing_purchase_billing_customer_id_billing_customer_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchase_offer_key" ON "billing_purchase" USING btree ("billing_customer_id","offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchase_session_key" ON "billing_purchase" USING btree ("provider_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchase_payment_key" ON "billing_purchase" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "billing_purchase_customer_idx" ON "billing_purchase" USING btree ("billing_customer_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);