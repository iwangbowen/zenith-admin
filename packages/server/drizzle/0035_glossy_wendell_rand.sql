ALTER TYPE "public"."export_job_format" ADD VALUE 'pdf';--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD COLUMN "access_count" integer DEFAULT 0 NOT NULL;