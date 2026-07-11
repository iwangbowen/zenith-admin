CREATE TYPE "public"."analytics_experiment_status" AS ENUM('draft', 'running', 'paused', 'completed');--> statement-breakpoint
CREATE TABLE "analytics_experiments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"exp_key" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"status" "analytics_experiment_status" DEFAULT 'draft' NOT NULL,
	"traffic_allocation" integer DEFAULT 100 NOT NULL,
	"variants" jsonb NOT NULL,
	"metric_event_name" varchar(128) NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_experiments" ADD CONSTRAINT "analytics_experiments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_experiments" ADD CONSTRAINT "analytics_experiments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_experiments" ADD CONSTRAINT "analytics_experiments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_experiments_tenant_key_uq" ON "analytics_experiments" USING btree (coalesce("tenant_id", 0),"exp_key");--> statement-breakpoint
CREATE INDEX "analytics_experiments_tenant_idx" ON "analytics_experiments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_experiments_status_idx" ON "analytics_experiments" USING btree ("status");