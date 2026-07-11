CREATE TYPE "public"."analytics_campaign_channel" AS ENUM('email', 'in_app', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."analytics_campaign_status" AS ENUM('draft', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "analytics_segment_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"segment_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"channel" "analytics_campaign_channel" NOT NULL,
	"template_id" integer,
	"webhook_url" varchar(500),
	"status" "analytics_campaign_status" DEFAULT 'draft' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_segment_id_analytics_user_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."analytics_user_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_segment_campaigns_tenant_idx" ON "analytics_segment_campaigns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_segment_campaigns_segment_idx" ON "analytics_segment_campaigns" USING btree ("segment_id");