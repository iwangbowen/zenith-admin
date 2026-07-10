ALTER TABLE "report_dataset_execution_logs" ADD COLUMN "bytes" integer;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD COLUMN "truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD COLUMN "slow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD COLUMN "last_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD COLUMN "last_test_status" varchar(16);--> statement-breakpoint
ALTER TABLE "report_datasources" ADD COLUMN "last_test_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD COLUMN "last_test_error" varchar(512);--> statement-breakpoint
ALTER TABLE "report_datasources" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;