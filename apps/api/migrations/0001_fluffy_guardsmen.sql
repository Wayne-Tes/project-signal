CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firebase_uid" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"brand_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sentiment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"label" varchar(20),
	"score" real,
	"confidence" real,
	"dimensions" text[],
	"topics" text[],
	"model_version" varchar(50),
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sentiment_results_signal_id_unique" UNIQUE("signal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dimension_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_entity_id" uuid NOT NULL,
	"date" date NOT NULL,
	"dimension" varchar(20) NOT NULL,
	"score" real NOT NULL,
	"signal_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "dimension_scores_brand_entity_id_date_dimension_unique" UNIQUE("brand_entity_id","date","dimension")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_brand_entity_id_brand_entities_id_fk" FOREIGN KEY ("brand_entity_id") REFERENCES "public"."brand_entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sentiment_results" ADD CONSTRAINT "sentiment_results_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dimension_scores" ADD CONSTRAINT "dimension_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dimension_scores" ADD CONSTRAINT "dimension_scores_brand_entity_id_brand_entities_id_fk" FOREIGN KEY ("brand_entity_id") REFERENCES "public"."brand_entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
