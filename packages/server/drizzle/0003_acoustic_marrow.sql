ALTER TABLE "export_jobs" ADD COLUMN "scope" varchar(16) DEFAULT 'filtered' NOT NULL;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "row_ids" jsonb;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "request_key" varchar(128);