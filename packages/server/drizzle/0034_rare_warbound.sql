CREATE TYPE "public"."report_dashboard_lifecycle_status" AS ENUM('draft', 'published', 'offline');--> statement-breakpoint
CREATE TYPE "public"."report_dashboard_version_source" AS ENUM('manual', 'publish', 'restore_backup');--> statement-breakpoint
CREATE TABLE "report_dashboard_embed_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"token_encrypted" varchar(256),
	"allowed_filter_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fixed_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expire_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_dashboard_embed_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" DROP CONSTRAINT "report_dashboard_comments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD COLUMN "resolved_by" integer;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD COLUMN "max_access_count" integer;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD COLUMN "allowed_cidrs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD COLUMN "allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboard_versions" ADD COLUMN "source" "report_dashboard_version_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD COLUMN "lifecycle_status" "report_dashboard_lifecycle_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD COLUMN "published_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD COLUMN "published_by" integer;--> statement-breakpoint
ALTER TABLE "report_dashboard_embed_tokens" ADD CONSTRAINT "report_dashboard_embed_tokens_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_embed_tokens" ADD CONSTRAINT "report_dashboard_embed_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_embed_tokens" ADD CONSTRAINT "report_dashboard_embed_tokens_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_dashboard_embed_tokens_dashboard_idx" ON "report_dashboard_embed_tokens" USING btree ("dashboard_id");--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_parent_id_report_dashboard_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."report_dashboard_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_dashboard_comments_parent_idx" ON "report_dashboard_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "report_dashboards_lifecycle_idx" ON "report_dashboards" USING btree ("lifecycle_status");