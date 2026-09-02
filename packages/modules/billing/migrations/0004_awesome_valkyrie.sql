CREATE TABLE "billing_purchase_session" (
	"provider_session_id" text PRIMARY KEY NOT NULL,
	"billing_purchase_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_refunded_payment" (
	"provider_payment_id" text PRIMARY KEY NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"last_event_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_purchase_session" ADD CONSTRAINT "billing_purchase_session_billing_purchase_id_billing_purchase_id_fk" FOREIGN KEY ("billing_purchase_id") REFERENCES "public"."billing_purchase"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Reprise des achats déjà ouverts : la version encore en ligne écrit
-- `billing_purchase.provider_session_id`, la nouvelle résout la session par
-- l'index inverse. Sans ce report, un paiement encaissé sur un checkout ouvert
-- **avant** le déploiement ne retrouverait plus son achat
-- (`docs/reliability.md` §4 : ajouter avant de lire).
--
-- `on conflict do nothing` la rend rejouable sans effet supplémentaire (§1).
INSERT INTO "billing_purchase_session" ("provider_session_id", "billing_purchase_id")
SELECT "provider_session_id", "id" FROM "billing_purchase"
ON CONFLICT ("provider_session_id") DO NOTHING;
