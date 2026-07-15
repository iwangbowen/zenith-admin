CREATE TYPE "public"."open_app_environment" AS ENUM('production', 'sandbox');--> statement-breakpoint
CREATE TYPE "public"."open_app_review_status" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "open_api_call_stats_daily" DROP CONSTRAINT "open_api_call_stats_daily_unique";--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "previous_client_secret_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "previous_client_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "previous_secret_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "environment" "open_app_environment" DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "review_status" "open_app_review_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "review_comment" text;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "open_api_call_logs" ADD COLUMN "environment" varchar(20) DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "open_api_call_stats_daily" ADD COLUMN "environment" varchar(20) DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_api_call_stats_daily" ADD CONSTRAINT "open_api_call_stats_daily_unique" UNIQUE("stat_date","client_id","path","environment");