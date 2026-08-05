CREATE TABLE IF NOT EXISTS "brand_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_aliases_brand_entity_id_alias_unique" UNIQUE("brand_entity_id","alias")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_brand_entity_id_brand_entities_id_fk" FOREIGN KEY ("brand_entity_id") REFERENCES "public"."brand_entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
