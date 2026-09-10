CREATE TYPE "public"."cron_run_trigger" AS ENUM('schedule', 'manual', 'retry');--> statement-breakpoint
ALTER TYPE "public"."cron_run_status" ADD VALUE 'timeout';--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD COLUMN "trigger" "cron_run_trigger" DEFAULT 'schedule' NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD COLUMN "latency_ms" integer GENERATED ALWAYS AS (CAST(EXTRACT(EPOCH FROM (started_at - scheduled_at)) * 1000 AS integer)) STORED;--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD COLUMN "node_id" varchar(128);--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD COLUMN "triggered_by" integer;--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD CONSTRAINT "cron_job_logs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_job_logs_job_started_idx" ON "cron_job_logs" USING btree ("job_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cron_job_logs_status_started_idx" ON "cron_job_logs" USING btree ("status","started_at" DESC NULLS LAST);--> statement-breakpoint
-- 历史失败记录的错误信息此前写在 output 里，回填到独立列，让失败原因聚合覆盖旧数据
UPDATE "cron_job_logs" SET "error_message" = "output" WHERE "status" = 'fail' AND "error_message" IS NULL AND "output" IS NOT NULL;
