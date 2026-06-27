DO $$ BEGIN
  CREATE TYPE "public"."mfa_factor_type" AS ENUM('totp', 'passkey', 'recovery_code');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."mfa_factor_status" AS ENUM('pending', 'enabled', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."login_risk_level" AS ENUM('low', 'medium', 'high');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."login_risk_action" AS ENUM('allow', 'challenge', 'block');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_mfa_factors" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "type" "mfa_factor_type" NOT NULL,
  "name" varchar(64) NOT NULL,
  "secret_encrypted" text,
  "credential_json" jsonb,
  "status" "mfa_factor_status" DEFAULT 'pending' NOT NULL,
  "verified_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_trusted_devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "device_id_hash" varchar(128) NOT NULL,
  "device_name" varchar(128),
  "ip" varchar(64),
  "user_agent" varchar(512),
  "trusted_until" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "login_risk_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "username" varchar(64) NOT NULL,
  "tenant_id" integer,
  "risk_level" "login_risk_level" DEFAULT 'low' NOT NULL,
  "reason" varchar(256) NOT NULL,
  "action" "login_risk_action" DEFAULT 'allow' NOT NULL,
  "ip" varchar(64),
  "location" varchar(128),
  "user_agent" varchar(512),
  "device_id_hash" varchar(128),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_trusted_devices" ADD CONSTRAINT "user_trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "login_risk_events" ADD CONSTRAINT "login_risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "login_risk_events" ADD CONSTRAINT "login_risk_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_mfa_factors_user_idx" ON "user_mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_mfa_factors_status_idx" ON "user_mfa_factors" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_trusted_devices_user_device_uq" ON "user_trusted_devices" USING btree ("user_id","device_id_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_trusted_devices_user_idx" ON "user_trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_trusted_devices_trusted_until_idx" ON "user_trusted_devices" USING btree ("trusted_until");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_risk_events_user_idx" ON "login_risk_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_risk_events_tenant_idx" ON "login_risk_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_risk_events_created_idx" ON "login_risk_events" USING btree ("created_at");
