CREATE TYPE "public"."report_delivery_status" AS ENUM('pending', 'running', 'success', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_delivery_target_type" AS ENUM('subscription', 'alert');--> statement-breakpoint
CREATE TYPE "public"."report_delivery_trigger_type" AS ENUM('manual', 'scheduled', 'trigger', 'recover');--> statement-breakpoint
CREATE TYPE "public"."report_schedule_misfire_policy" AS ENUM('skip', 'fire_once');--> statement-breakpoint
CREATE TABLE "report_delivery_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"run_id" integer NOT NULL,
	"channel" varchar(16) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "report_delivery_status" DEFAULT 'pending' NOT NULL,
	"duration_ms" integer,
	"error_message" varchar(512),
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_delivery_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"target_type" "report_delivery_target_type" NOT NULL,
	"subscription_id" integer,
	"alert_rule_id" integer,
	"dashboard_id" integer,
	"dataset_id" integer,
	"target_name" varchar(128),
	"trigger_type" "report_delivery_trigger_type" NOT NULL,
	"status" "report_delivery_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"duration_ms" integer,
	"error_message" varchar(512),
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_value" real,
	"triggered" boolean,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer,
	"acknowledge_note" varchar(500),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"requested_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "misfire_policy" "report_schedule_misfire_policy" DEFAULT 'fire_once' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "last_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "last_delivery_status" "report_delivery_status";--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "last_delivery_error" varchar(512);--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "misfire_policy" "report_schedule_misfire_policy" DEFAULT 'fire_once' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "last_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "last_delivery_status" "report_delivery_status";--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "last_delivery_error" varchar(512);--> statement-breakpoint
ALTER TABLE "report_delivery_attempts" ADD CONSTRAINT "report_delivery_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_attempts" ADD CONSTRAINT "report_delivery_attempts_run_id_report_delivery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_delivery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_subscription_id_report_dashboard_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."report_dashboard_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_alert_rule_id_report_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."report_alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_delivery_attempts_run_channel_attempt_uq" ON "report_delivery_attempts" USING btree ("run_id","channel","attempt");--> statement-breakpoint
CREATE INDEX "report_delivery_attempts_run_idx" ON "report_delivery_attempts" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_attempts_tenant_idx" ON "report_delivery_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_delivery_runs_idempotency_uq" ON "report_delivery_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_target_idx" ON "report_delivery_runs" USING btree ("target_type","subscription_id","alert_rule_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_subscription_idx" ON "report_delivery_runs" USING btree ("subscription_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_alert_idx" ON "report_delivery_runs" USING btree ("alert_rule_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_retry_idx" ON "report_delivery_runs" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_tenant_idx" ON "report_delivery_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_alert_rules_next_run_idx" ON "report_alert_rules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "report_dashboard_subscriptions_next_run_idx" ON "report_dashboard_subscriptions" USING btree ("next_run_at");