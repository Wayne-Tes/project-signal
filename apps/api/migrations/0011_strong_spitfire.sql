ALTER TABLE "source_configs" DROP CONSTRAINT "source_configs_brand_entity_id_source_unique";--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "source_config_id" uuid;--> statement-breakpoint
ALTER TABLE "source_configs" ADD COLUMN "label" varchar(120);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" ADD CONSTRAINT "signals_source_config_id_source_configs_id_fk" FOREIGN KEY ("source_config_id") REFERENCES "public"."source_configs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_source_config_idx" ON "signals" USING btree ("source_config_id","published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_configs_tenant_brand_idx" ON "source_configs" USING btree ("tenant_id","brand_entity_id");