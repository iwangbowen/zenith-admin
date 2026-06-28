CREATE TYPE "public"."workflow_connector_type" AS ENUM('http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database');--> statement-breakpoint
CREATE TABLE "workflow_connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" text,
	"type" "workflow_connector_type" DEFAULT 'http' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_encrypted" text,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"retry_max" integer DEFAULT 0 NOT NULL,
	"circuit_breaker_enabled" boolean DEFAULT true NOT NULL,
	"failure_threshold" integer DEFAULT 5 NOT NULL,
	"cooldown_sec" integer DEFAULT 60 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_connectors_code_uniq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD CONSTRAINT "workflow_connectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD CONSTRAINT "workflow_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD CONSTRAINT "workflow_connectors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;