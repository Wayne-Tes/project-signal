CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"segment" varchar(64),
	"arr_band" varchar(16),
	"owner_name" varchar(200),
	"territory" varchar(16) DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_tenant_provider_external_uniq" UNIQUE("tenant_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"instance_url" text,
	"secret_arn" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"connected_by" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_connections_tenant_provider_uniq" UNIQUE("tenant_id","provider")
);
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "voice" varchar(16) DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_tenant_idx" ON "accounts" USING btree ("tenant_id","arr_band");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_connections_tenant_idx" ON "crm_connections" USING btree ("tenant_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" ADD CONSTRAINT "signals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
