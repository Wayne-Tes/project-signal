CREATE TABLE IF NOT EXISTS "tracked_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_entity_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"territory" varchar(16) DEFAULT 'all' NOT NULL,
	"status" varchar(16) DEFAULT 'accepted' NOT NULL,
	"baseline_at" timestamp with time zone DEFAULT now() NOT NULL,
	"baseline_index" real,
	"baseline_damage" real,
	"baseline_volume" integer,
	"ceiling_delta" real,
	"accepted_by" varchar(128),
	"note" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracked_actions" ADD CONSTRAINT "tracked_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracked_actions" ADD CONSTRAINT "tracked_actions_brand_entity_id_brand_entities_id_fk" FOREIGN KEY ("brand_entity_id") REFERENCES "public"."brand_entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracked_actions_brand_idx" ON "tracked_actions" USING btree ("tenant_id","brand_entity_id","baseline_at");