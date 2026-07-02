CREATE TYPE "public"."async_task_status" AS ENUM('pending', 'running', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "async_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_type" varchar(64) NOT NULL,
	"title" varchar(128) NOT NULL,
	"status" "async_task_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_count" integer,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"progress_note" varchar(256),
	"checkpoint" jsonb,
	"result" jsonb,
	"error_message" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "async_tasks_type_idx" ON "async_tasks" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "async_tasks_status_idx" ON "async_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "async_tasks_created_by_idx" ON "async_tasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "async_tasks_created_at_idx" ON "async_tasks" USING btree ("created_at");