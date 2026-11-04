-- Identity work now belongs to async_tasks. Retired workflow work is removed rather
-- than replayed or translated; workflow instances, approvals and identity grants remain.
DELETE FROM "workflow_job_executions" WHERE "job_type"::text IN ('access_grant_apply', 'access_review_build');--> statement-breakpoint
DELETE FROM "workflow_jobs" WHERE "job_type"::text IN ('access_grant_apply', 'access_review_build');--> statement-breakpoint
ALTER TABLE "workflow_job_executions" ALTER COLUMN "job_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ALTER COLUMN "job_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."workflow_job_type";--> statement-breakpoint
CREATE TYPE "public"."workflow_job_type" AS ENUM('delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch', 'subprocess_spawn', 'subprocess_join', 'node_listener_delivery', 'webhook_delivery', 'compensation_action', 'automation_action', 'schedule_launch');--> statement-breakpoint
ALTER TABLE "workflow_job_executions" ALTER COLUMN "job_type" SET DATA TYPE "public"."workflow_job_type" USING "job_type"::"public"."workflow_job_type";--> statement-breakpoint
ALTER TABLE "workflow_jobs" ALTER COLUMN "job_type" SET DATA TYPE "public"."workflow_job_type" USING "job_type"::"public"."workflow_job_type";