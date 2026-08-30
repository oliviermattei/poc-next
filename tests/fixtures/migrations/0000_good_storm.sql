CREATE TABLE "fixture_item" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
