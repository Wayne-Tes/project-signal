CREATE TABLE IF NOT EXISTS "signal_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"brand_entity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_mentions_signal_id_brand_entity_id_unique" UNIQUE("signal_id","brand_entity_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_mentions" ADD CONSTRAINT "signal_mentions_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_mentions" ADD CONSTRAINT "signal_mentions_brand_entity_id_brand_entities_id_fk" FOREIGN KEY ("brand_entity_id") REFERENCES "public"."brand_entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signal_mentions" ADD CONSTRAINT "signal_mentions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_mentions_entity_idx" ON "signal_mentions" USING btree ("tenant_id","brand_entity_id");