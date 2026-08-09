ALTER TABLE "brand_entities" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_entities" ADD COLUMN "kind" varchar(16) DEFAULT 'brand' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_entities" ADD CONSTRAINT "brand_entities_parent_id_brand_entities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."brand_entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_entities_tenant_parent_idx" ON "brand_entities" USING btree ("tenant_id","parent_id");