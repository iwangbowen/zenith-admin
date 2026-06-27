DO $$ BEGIN
  CREATE TYPE "public"."identity_provider_type" AS ENUM('oidc', 'saml');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."identity_provider_status" AS ENUM('enabled', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_identity_providers" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer,
  "name" varchar(100) NOT NULL,
  "code" varchar(64) NOT NULL,
  "type" "identity_provider_type" NOT NULL,
  "status" "identity_provider_status" DEFAULT 'disabled' NOT NULL,
  "issuer" varchar(512),
  "authorization_endpoint" varchar(512),
  "token_endpoint" varchar(512),
  "userinfo_endpoint" varchar(512),
  "jwks_uri" varchar(512),
  "client_id" varchar(256),
  "client_secret" text,
  "scopes" varchar(256) DEFAULT 'openid profile email' NOT NULL,
  "saml_sso_url" varchar(512),
  "saml_entity_id" varchar(512),
  "saml_certificate" text,
  "attribute_mapping" jsonb DEFAULT '{"subject":"sub","email":"email","username":"preferred_username","nickname":"name"}'::jsonb NOT NULL,
  "jit_enabled" boolean DEFAULT false NOT NULL,
  "default_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "remark" text,
  "created_by" integer,
  "updated_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_identity_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "provider_id" integer NOT NULL,
  "subject" varchar(256) NOT NULL,
  "email" varchar(128),
  "username" varchar(64),
  "display_name" varchar(128),
  "raw_profile" jsonb,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "tenant_identity_providers" ADD CONSTRAINT "tenant_identity_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenant_identity_providers" ADD CONSTRAINT "tenant_identity_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenant_identity_providers" ADD CONSTRAINT "tenant_identity_providers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_identity_accounts" ADD CONSTRAINT "user_identity_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_identity_accounts" ADD CONSTRAINT "user_identity_accounts_provider_id_tenant_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tenant_identity_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_identity_providers_tenant_code_unique" ON "tenant_identity_providers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_identity_providers_tenant_idx" ON "tenant_identity_providers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_identity_providers_status_idx" ON "tenant_identity_providers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identity_accounts_provider_subject_unique" ON "user_identity_accounts" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_identity_accounts_user_provider_unique" ON "user_identity_accounts" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identity_accounts_user_idx" ON "user_identity_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_identity_accounts_provider_idx" ON "user_identity_accounts" USING btree ("provider_id");
