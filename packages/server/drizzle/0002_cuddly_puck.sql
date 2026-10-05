ALTER TYPE "public"."workflow_job_execution_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TYPE "public"."workflow_job_execution_status" ADD VALUE 'canceled';--> statement-breakpoint
ALTER TYPE "public"."workflow_job_type" ADD VALUE 'automation_action';--> statement-breakpoint
ALTER TYPE "public"."workflow_job_type" ADD VALUE 'schedule_launch';--> statement-breakpoint
DROP TABLE "workflow_automation_runs" CASCADE;