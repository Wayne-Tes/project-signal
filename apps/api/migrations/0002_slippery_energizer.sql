CREATE TABLE IF NOT EXISTS "source_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_entity_id" uuid NOT NULL,
	"source" varchar(50) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_configs_brand_entity_id_source_unique" UNIQUE("brand_entity_id","source")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_configs" ADD CONSTRAINT "source_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_configs" ADD CONSTRAINT "source_configs_brand_entity_id_brand_entities_id_fk" FOREIGN KEY ("brand_entity_id") REFERENCES "public"."brand_entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
