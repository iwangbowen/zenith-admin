DO $$ BEGIN
  ALTER TYPE "public"."identity_provider_type" ADD VALUE 'ldap';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."identity_provider_type" ADD VALUE 'ad';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."identity_provider_sync_status" AS ENUM('success', 'failed', 'partial');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_url" varchar(512);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_start_tls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_skip_tls_verify" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_base_dn" varchar(512);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_bind_dn" varchar(512);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_bind_password" text;--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_user_filter" varchar(1000);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_user_search_filter" varchar(1000);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_sync_filter" varchar(1000);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_group_base_dn" varchar(512);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_group_filter" varchar(1000);--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD COLUMN IF NOT EXISTS "ldap_timeout_ms" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "identity_provider_sync_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider_id" integer NOT NULL,
  "status" "identity_provider_sync_status" NOT NULL,
  "trigger_type" varchar(32) DEFAULT 'manual' NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "created" integer DEFAULT 0 NOT NULL,
  "linked" integer DEFAULT 0 NOT NULL,
  "updated" integer DEFAULT 0 NOT NULL,
  "skipped" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  "message" text,
  "error_message" text,
  "details" jsonb,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "identity_provider_sync_logs" ADD CONSTRAINT "identity_provider_sync_logs_provider_id_tenant_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tenant_identity_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_provider_sync_logs_provider_idx" ON "identity_provider_sync_logs" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_provider_sync_logs_status_idx" ON "identity_provider_sync_logs" USING btree ("status");
