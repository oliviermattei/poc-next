CREATE TABLE "billing_customer" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"provider_subscription_id" text PRIMARY KEY NOT NULL,
	"billing_customer_id" text NOT NULL,
	"offer_id" text,
	"price_id" text NOT NULL,
	"status" text NOT NULL,
	"quantity" integer NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean NOT NULL,
	"trial_end" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"last_event_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_billing_customer_id_billing_customer_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_scope_key" ON "billing_customer" USING btree ("scope_kind","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_provider_key" ON "billing_customer" USING btree ("provider_customer_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_customer_idx" ON "billing_subscription" USING btree ("billing_customer_id");