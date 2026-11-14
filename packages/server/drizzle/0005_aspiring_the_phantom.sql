CREATE TABLE "export_daily_usage" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"period" varchar(10) NOT NULL,
	"job_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "split_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
CREATE INDEX "export_daily_usage_period_idx" ON "export_daily_usage" USING btree ("period");