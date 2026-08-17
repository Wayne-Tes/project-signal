ALTER TABLE "dimension_scores" DROP CONSTRAINT "dimension_scores_brand_entity_id_date_dimension_unique";--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "territory" varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "dimension_scores" ADD COLUMN "territory" varchar(16) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_configs" ADD COLUMN "territory" varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dimension_scores_brand_territory_date_idx" ON "dimension_scores" USING btree ("brand_entity_id","territory","date");--> statement-breakpoint
ALTER TABLE "dimension_scores" ADD CONSTRAINT "dimension_scores_brand_date_dim_territory_uniq" UNIQUE("brand_entity_id","date","dimension","territory");