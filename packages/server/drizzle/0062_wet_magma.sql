CREATE TYPE "public"."workflow_event_delivery_status" AS ENUM('pending', 'success', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."workflow_event_sign_mode" AS ENUM('hmacSha256', 'none');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_external_dispatch_status" AS ENUM('pending', 'dispatched', 'failed', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."workflow_trigger_execution_status" AS ENUM('pending', 'running', 'success', 'failed', 'retrying');--> statement-breakpoint
CREATE TABLE "workflow_event_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"instance_id" integer,
	"task_id" integer,
	"event_id" varchar(64) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" "workflow_event_delivery_status" DEFAULT 'pending' NOT NULL,
	"request_url" varchar(512),
	"request_headers" text,
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"duration_ms" integer,
	"next_retry_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_event_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(256),
	"definition_id" integer,
	"events" text NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret" varchar(256),
	"sign_mode" "workflow_event_sign_mode" DEFAULT 'hmacSha256' NOT NULL,
	"headers" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_trigger_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"task_id" integer,
	"node_key" varchar(64) NOT NULL,
	"node_name" varchar(64),
	"trigger_type" varchar(32) NOT NULL,
	"status" "workflow_trigger_execution_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"request_url" varchar(512),
	"request_method" varchar(16),
	"request_body" text,
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"duration_ms" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "external_callback_id" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "external_dispatch_status" "workflow_task_external_dispatch_status";--> statement-breakpoint
ALTER TABLE "workflow_event_deliveries" ADD CONSTRAINT "workflow_event_deliveries_subscription_id_workflow_event_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."workflow_event_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_deliveries" ADD CONSTRAINT "workflow_event_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_trigger_executions" ADD CONSTRAINT "workflow_trigger_executions_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_trigger_executions" ADD CONSTRAINT "workflow_trigger_executions_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_trigger_executions" ADD CONSTRAINT "workflow_trigger_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_external_callback_id_unique" UNIQUE("external_callback_id");