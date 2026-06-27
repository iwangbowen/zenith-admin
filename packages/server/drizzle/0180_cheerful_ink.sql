CREATE TYPE "public"."login_risk_action" AS ENUM('allow', 'challenge', 'block');--> statement-breakpoint
CREATE TYPE "public"."login_risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."mfa_factor_status" AS ENUM('pending', 'enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."mfa_factor_type" AS ENUM('totp', 'passkey', 'recovery_code');--> statement-breakpoint
CREATE TABLE "login_risk_events" (
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
);
--> statement-breakpoint
CREATE TABLE "system_scheduler_nodes" (
	"node_id" varchar(128) PRIMARY KEY NOT NULL,
	"hostname" varchar(128) NOT NULL,
	"pid" integer NOT NULL,
	"version" varchar(64),
	"started_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"registered_task_count" integer DEFAULT 0 NOT NULL,
	"running_job_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_mfa_factors" (
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
);
--> statement-breakpoint
CREATE TABLE "user_trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id_hash" varchar(128) NOT NULL,
	"device_name" varchar(128),
	"ip" varchar(64),
	"user_agent" varchar(512),
	"trusted_until" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "alert_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "alert_channels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "alert_ack_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "alert_ack_by" integer;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "alert_ack_note" text;--> statement-breakpoint
ALTER TABLE "system_scheduler_task_configs" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_scheduler_task_configs" ADD COLUMN "alert_channels" jsonb DEFAULT '["inapp"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "system_scheduler_task_configs" ADD COLUMN "alert_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "system_scheduler_task_configs" ADD COLUMN "alert_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "system_scheduler_task_configs" ADD COLUMN "alert_webhook_url" varchar(512);--> statement-breakpoint
ALTER TABLE "login_risk_events" ADD CONSTRAINT "login_risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_risk_events" ADD CONSTRAINT "login_risk_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_trusted_devices" ADD CONSTRAINT "user_trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_risk_events_user_idx" ON "login_risk_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_risk_events_tenant_idx" ON "login_risk_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "login_risk_events_created_idx" ON "login_risk_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_nodes_active_idx" ON "system_scheduler_nodes" USING btree ("active");--> statement-breakpoint
CREATE INDEX "system_scheduler_nodes_last_heartbeat_idx" ON "system_scheduler_nodes" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "user_mfa_factors_user_idx" ON "user_mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_mfa_factors_status_idx" ON "user_mfa_factors" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_trusted_devices_user_device_uq" ON "user_trusted_devices" USING btree ("user_id","device_id_hash");--> statement-breakpoint
CREATE INDEX "user_trusted_devices_user_idx" ON "user_trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_trusted_devices_trusted_until_idx" ON "user_trusted_devices" USING btree ("trusted_until");--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD CONSTRAINT "system_scheduler_runs_alert_ack_by_users_id_fk" FOREIGN KEY ("alert_ack_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_alert_ack_by_idx" ON "system_scheduler_runs" USING btree ("alert_ack_by");--> statement-breakpoint
INSERT INTO "menus" ("id", "parent_id", "title", "type", "sort", "status", "visible", "permission", "created_at", "updated_at")
VALUES
  (539, 535, '确认告警', 'button', 4, 'enabled', true, 'system:scheduler:alert', now(), now())
ON CONFLICT ("id") DO UPDATE SET
  "parent_id" = EXCLUDED."parent_id",
  "title" = EXCLUDED."title",
  "type" = EXCLUDED."type",
  "sort" = EXCLUDED."sort",
  "status" = EXCLUDED."status",
  "visible" = EXCLUDED."visible",
  "permission" = EXCLUDED."permission",
  "updated_at" = now();--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
JOIN "menus" m ON m."id" IN (539)
WHERE r."code" = 'super_admin'
ON CONFLICT DO NOTHING;
