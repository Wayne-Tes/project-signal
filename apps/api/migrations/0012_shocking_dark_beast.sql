ALTER TABLE "source_configs" ADD COLUMN "last_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_configs" ADD COLUMN "last_error" text;