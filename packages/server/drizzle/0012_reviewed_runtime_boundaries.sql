ALTER TYPE "public"."workflow_job_status" ADD VALUE 'paused' BEFORE 'succeeded';--> statement-breakpoint
DROP INDEX "login_risk_events_tenant_idx";--> statement-breakpoint
DROP INDEX "login_risk_events_created_idx";--> statement-breakpoint
ALTER TABLE "async_tasks" ADD COLUMN "retry_delay_ms" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "async_tasks" ALTER COLUMN "retry_delay_ms" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_job_executions" ADD COLUMN "generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_job_executions" ADD COLUMN "lease_token" varchar(64) DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "operation_key" varchar(64) DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "execution_timeout_ms" integer DEFAULT 600000 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "lease_token" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "execution_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "paused_remaining_ms" integer;--> statement-breakpoint
CREATE INDEX "login_risk_events_tenant_created_id_idx" ON "login_risk_events" USING btree ("tenant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "login_risk_events_created_id_idx" ON "login_risk_events" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_job_executions_lease_token_unique" ON "workflow_job_executions" USING btree ("lease_token");--> statement-breakpoint
CREATE INDEX "workflow_jobs_lease_idx" ON "workflow_jobs" USING btree ("status","lease_until");
