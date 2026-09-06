CREATE TABLE "onboarding_progress" (
	"user_id" text PRIMARY KEY NOT NULL,
	"cleared_steps" jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
