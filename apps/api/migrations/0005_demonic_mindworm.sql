ALTER TABLE "signals" DROP COLUMN IF EXISTS "sentiment_label";--> statement-breakpoint
ALTER TABLE "signals" DROP COLUMN IF EXISTS "sentiment_score";--> statement-breakpoint
ALTER TABLE "signals" DROP COLUMN IF EXISTS "confidence";--> statement-breakpoint
ALTER TABLE "signals" DROP COLUMN IF EXISTS "model_version";